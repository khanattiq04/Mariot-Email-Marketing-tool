import { buildEmailHtml } from "./emailTemplate";

test("renders the complete Mariot newsletter and all eight image fields", () => {
  const html = buildEmailHtml({
    headline: "Tools & <b>craft</b>",
    heroImage: "https://images.example/hero.jpg",
    image1: "https://images.example/one.jpg",
    image2: "https://images.example/two.jpg",
    image3: "https://images.example/three.jpg",
    image4: "https://images.example/four.jpg",
    image5: "https://images.example/five.jpg",
    image6: "https://images.example/six.jpg",
    image7: "https://images.example/seven.jpg",
  });

  expect(html).toContain("Mariot Store&nbsp; / &nbsp;Kitchen Edit");
  expect(html).toContain("Tools &amp; &lt;b&gt;craft&lt;/b&gt;");
  expect(html).toContain("Notes from the kitchen");
  expect(html).toContain(">Popular</h2>");
  expect(html).toContain(">Inspirations</h2>");
  expect(html).toContain(">Hotspots</h2>");
  expect(html).toContain("Made for the rhythm of service");
  expect(html).toContain("A sharper start to every service");
  expect(html).toContain("professional favourites selected for the demands");
  expect(html).toContain("You’re receiving this email from Mariot Store.");
  expect(html).toContain('href="https://mariotstore.com/"');
  expect(html.match(/href="https:\/\/mariotstore\.com\/en\/shop-by-brands"/g)).toHaveLength(2);
  expect(html.match(/href="https:\/\/mariotstore\.com\/en\/shop"/g)).toHaveLength(2);
  const footer = html.slice(html.indexOf("You’re receiving this email"));
  expect(footer).not.toContain("mariot-logo.png");
  expect(html.indexOf("Kitchen Edit")).toBeLessThan(html.indexOf(">Popular</h2>"));
  expect(html.indexOf(">Popular</h2>")).toBeLessThan(html.indexOf(">Inspirations</h2>"));
  expect(html.indexOf(">Inspirations</h2>")).toBeLessThan(html.indexOf(">Hotspots</h2>"));
  expect(html.indexOf(">Hotspots</h2>")).toBeLessThan(html.indexOf("Unsubscribe"));
  for (const image of ["hero", "one", "two", "three", "four", "five", "six", "seven"]) {
    expect(html).toContain(`https://images.example/${image}.jpg`);
  }
  expect(html).toContain(".popular-col{display:table-cell!important;width:50%!important");
  expect(html).toContain(".popular-third{display:none!important}");
  expect(html).toContain("height:auto;object-fit:contain");
  expect(html).not.toContain("object-fit:cover");
  expect(html).toContain('class="popular-col popular-third"');
  expect(html).toContain(".fluid-img.inspiration-image{max-width:480px!important");
  expect(html).toContain(".fluid-img.inspiration-image,.image-placeholder.inspiration-image{max-width:100%!important}");
});

test("shows upload placeholders for empty image fields", () => {
  const html = buildEmailHtml({});

  expect(html.match(/min-height:/g)).toHaveLength(8);
  expect(html).toContain("Upload the lead kitchen image");
  expect(html).toContain("Popular product image 1");
  expect(html).toContain("Popular product image 2");
  expect(html).toContain("Popular product image 3");
  expect(html).toContain("Inspiration kitchen image 1");
  expect(html).toContain("Inspiration kitchen image 2");
  expect(html).toContain("Hotspot product image 1");
  expect(html).toContain("Hotspot product image 2");
});
