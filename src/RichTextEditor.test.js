import { fireEvent, render } from "@testing-library/react";
import RichTextEditor from "./RichTextEditor";
import { buildEmailHtml } from "./emailTemplate";

test("pastes plain text without importing website formatting", () => {
  const onChange = jest.fn();
  const { container } = render(
    <RichTextEditor value="" onChange={onChange} placeholder="Write here" />
  );
  const editor = container.querySelector('[contenteditable="true"]');
  const getData = jest.fn((type) => {
    if (type === "text/plain") return "Clean text\nSecond line";
    if (type === "text/html") {
      return '<p style="font-family:Fantasy;color:red;background:yellow">Styled website text</p>';
    }
    return "";
  });

  fireEvent.paste(editor, {
    clipboardData: { getData },
  });

  expect(editor.textContent).toBe("Clean textSecond line");
  expect(editor.querySelector("[style]")).toBeNull();
  expect(editor.querySelector("br")).toBeInTheDocument();
  expect(onChange).toHaveBeenCalledWith(expect.not.stringContaining("Fantasy"));
  expect(onChange).toHaveBeenCalledWith(expect.not.stringContaining("yellow"));
});

test("uses the brand email font on all editor text in the generated email", () => {
  const html = buildEmailHtml({
    message: '<span style="font-family:Fantasy">Hello</span>',
  });

  expect(html).toContain(
    ".content-text,.content-text *{font-family:Arial,Helvetica,sans-serif!important;"
  );
});
