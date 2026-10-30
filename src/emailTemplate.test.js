import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import emailTemplate from "./emailTemplate";

const { buildEmailHtml, buildEmailText } = emailTemplate;

const FULL = {
  fromName: "Mariot Store",
  headline: "Tools & <b>craft</b>",
  message: "<p>Hello, it's <b>us</b>.</p>",
  heroImage: "https://images.example/hero.jpg",
  image1: "https://images.example/one.jpg",
  image2: "https://images.example/two.jpg",
  image3: "https://images.example/three.jpg",
  image4: "https://images.example/four.jpg",
  image5: "https://images.example/five.jpg",
  image6: "https://images.example/six.jpg",
  image7: "https://images.example/seven.jpg",
};

const OPTIONS = {
  logoUrl: "https://cdn.example/logo.png",
  iconBase: "https://cdn.example/icons",
  unsubscribeUrl: "https://shop.example/api/unsubscribe?email=a%40b.com",
  companyAddress: "Dubai, UAE",
};

test("renders every section in order with escaped content", () => {
  const html = buildEmailHtml(FULL, OPTIONS);

  expect(html.startsWith("<!DOCTYPE html")).toBe(true);
  expect(html).toContain("<title>");
  expect(html).toContain('name="color-scheme"');
  expect(html).toContain("Tools &amp; &lt;b&gt;craft&lt;/b&gt;");
  expect(html).not.toContain("<b>craft</b>");

  const order = ["Kitchen Edit", ">Popular</h2>", ">Inspirations</h2>", ">Hotspots</h2>", "Unsubscribe"];
  const positions = order.map((s) => html.indexOf(s));
  positions.forEach((p) => expect(p).toBeGreaterThan(-1));
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);

  for (const image of ["hero", "one", "two", "three", "four", "five", "six", "seven"]) {
    expect(html).toContain(`https://images.example/${image}.jpg`);
  }
  expect(html.match(/EXPLORE MORE/g)).toHaveLength(2);
  expect(html.match(/Shop Now/g)).toHaveLength(2);
});

test("images carry width attributes for Outlook and never use object-fit:cover", () => {
  const html = buildEmailHtml(FULL, OPTIONS);
  expect(html).toMatch(/<img[^>]+hero\.jpg[^>]+width="650"/);
  expect(html).toMatch(/<img[^>]+four\.jpg[^>]+width="291"/);
  expect(html).toMatch(/<img[^>]+six\.jpg[^>]+width="140"/);
  expect(html).not.toContain("object-fit:cover");
});

test("footer has a working unsubscribe link, the address and no logo", () => {
  const html = buildEmailHtml(FULL, OPTIONS);
  const footer = html.slice(html.indexOf("receiving this email"));
  expect(footer).toContain('href="https://shop.example/api/unsubscribe?email=a%40b.com"');
  expect(footer).toContain("Dubai, UAE");
  expect(footer).toContain("Visit our store");
  expect(footer).not.toContain("logo.png");
});

test("hidden preheader is built from the intro copy", () => {
  const html = buildEmailHtml(FULL, OPTIONS);
  const start = html.indexOf("<body");
  const pre = html.slice(start, start + 3000);
  expect(pre).toContain("Hello, it&#39;s us.");
  expect(pre).toContain("&zwnj;");
});

test("sent emails drop empty image slots instead of showing placeholders", () => {
  const html = buildEmailHtml({}, OPTIONS);
  expect(html).not.toContain("image-placeholder ");
  expect(html).not.toContain("min-height:");
  expect(html).not.toMatch(/<img[^>]+src=""/);
});

test("preview mode shows placeholders for empty image slots", () => {
  const html = buildEmailHtml({}, { ...OPTIONS, preview: true });
  expect(html).toContain("Featured kitchen");
  expect(html).toContain("Inspiration kitchen image 1");
  expect(html).toContain("Hotspot product image 2");
});

test("popular gallery only lays out the images that exist", () => {
  const two = buildEmailHtml({ image1: "https://i/1.jpg", image3: "https://i/3.jpg" }, OPTIONS);
  expect(two).toContain("https://i/1.jpg");
  expect(two).toContain("https://i/3.jpg");
  expect(two).not.toContain('class="popular-col popular-third"');

  const three = buildEmailHtml(FULL, OPTIONS);
  expect(three).toContain('class="popular-col popular-third"');
});

test("plain-text part carries the copy and the unsubscribe link", () => {
  const text = buildEmailText(FULL, OPTIONS);
  expect(text).toContain("Tools & <b>craft</b>");
  expect(text).toContain("Hello, it's us.");
  expect(text).toContain("Unsubscribe: https://shop.example/api/unsubscribe?email=a%40b.com");
  expect(text).toContain("Dubai, UAE");
  expect(text).not.toContain("<p>");
});

// The Hostinger sender (public/api/send-email.php) has its own copy of the
// template. When PHP is installed, check that it renders the same email.
const phpAvailable = (() => {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
})();

(phpAvailable ? test : test.skip)("PHP sender renders the same HTML and text", () => {
  const cases = [
    { c: {}, o: {} },
    { c: FULL, o: OPTIONS },
    { c: { image2: "https://i/2.jpg", image5: "https://i/5.jpg" }, o: { ...OPTIONS, preview: true } },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "email-parity-"));
  const casesFile = path.join(dir, "cases.json");
  const script = path.join(dir, "render.php");
  fs.writeFileSync(casesFile, JSON.stringify(cases));
  fs.writeFileSync(
    script,
    `<?php
$src = file_get_contents($argv[1]);
$cStart = strpos($src, "const EMAIL_FONT");
$cEnd = strpos($src, "\\nSKELETON;\\n", $cStart) + strlen("\\nSKELETON;\\n");
eval(substr($src, $cStart, $cEnd - $cStart));
$start = strpos($src, "// ---------------------------------------------------------------- template --");
$end = strpos($src, "\\nfunction build_html(");
eval(substr($src, $start, $end - $start));
$out = array();
foreach (json_decode(file_get_contents($argv[2]), true) as $x) {
  $out[] = array(build_email_html($x['c'], $x['o']), build_email_text($x['c'], $x['o']));
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
`
  );
  const phpFile = path.join(__dirname, "..", "public", "api", "send-email.php");
  const php = JSON.parse(execFileSync("php", [script, phpFile, casesFile], { encoding: "utf8" }));
  cases.forEach((x, i) => {
    expect(php[i][0]).toBe(buildEmailHtml(x.c, x.o));
    expect(php[i][1]).toBe(buildEmailText(x.c, x.o));
  });
});

// PHP defines a top-level `const` only when execution reaches it, so the
// template constants must sit above the code that handles the request.
test("PHP sender defines the template constants before sending", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "api", "send-email.php"), "utf8");
  const firstConst = src.indexOf("const EMAIL_FONT");
  const firstSend = src.indexOf("send_campaign($body);");
  expect(firstConst).toBeGreaterThan(-1);
  expect(firstSend).toBeGreaterThan(-1);
  expect(firstConst).toBeLessThan(firstSend);
});
