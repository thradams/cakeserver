const editor = document.getElementById("c-editor");
const highlight = document.getElementById("highlight");
const gutter = document.getElementById("gutter");
const output = document.getElementById("output");

const keywords = /\b(int|char|float|double|void|if|else|for|while|return|struct|break|continue)\b/g;
const types = /\b(size_t|uint|uint32_t|uint8_t)\b/g;

function escapeHtml(s)
{
    return s.replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function syntaxHighlight(code)
{
    code = escapeHtml(code);

    code = code.replace(/(\/\/.*?$)/gm, '<span class="com">$1</span>');
    code = code.replace(/(".*?"|'.*?')/g, '<span class="str">$1</span>');
    code = code.replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
    code = code.replace(keywords, '<span class="kw">$1</span>');
    code = code.replace(types, '<span class="type">$1</span>');

    return code;
}

function updateLineNumbers(text)
{
    const lines = text.split("\n").length || 1;
    let out = "";
    for (let i = 1; i <= lines; i++)
    {
        out += i + "\n";
    }
    gutter.textContent = out;
}

function fakeRun(code)
{
    output.textContent =
        `[build]
compiling...

[output]
${code.length} chars
${code.split("\n").length} lines`;
}

function update()
{
    const value = editor.value;

    highlight.innerHTML = syntaxHighlight(value);
    updateLineNumbers(value);
    fakeRun(value);
}

editor.addEventListener("input", update);

editor.addEventListener("scroll", () =>
{
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    gutter.scrollTop = editor.scrollTop;
});

// init
editor.value =
    `#include <stdio.h>

int main() {
    int a = 10;
    printf("Hello %d\\n", a);
    return 0;
}
`;

update();