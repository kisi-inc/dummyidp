export function xml(strings: TemplateStringsArray, ...values: any[]): string {
  return strings
    .reduce(
      (result, s, i) =>
        result + s + (i < values.length ? String(values[i]) : ""),
      "",
    )
    .replace(/\r?\n/g, " ") // newlines -> spaces
    .replace(/\t/g, " ") // tabs -> spaces
    .replace(/\s{2,}/g, " ") // collapse multiple spaces
    .replace(/>\s+</g, "><") // remove spaces between tags
    .replace(/>\s+/g, ">") // trim leading space of text nodes
    .replace(/\s+</g, "<") // trim trailing space of text nodes
    .trim();
}
