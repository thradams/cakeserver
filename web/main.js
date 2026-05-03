const API = "http://localhost:8080";

let currentPath = "";
let currentFile = "";

async function loadFiles()
{
    const path = document.getElementById("pathInput").value;
    currentPath = path;

    const res = await fetch(`${API}/list?path=${encodeURIComponent(path)}`);
    const files = await res.json();

    const select = document.getElementById("fileList");
    const saveBtn = document.getElementById("saveBtn");

    select.innerHTML = '<option value="">-- files --</option>';
    saveBtn.disabled = true;

    files.forEach(f =>
    {
        const opt = document.createElement("option");
        opt.value = f;
        opt.textContent = f;
        select.appendChild(opt);
    });

    if (files.length > 0)
    {
        select.selectedIndex = 1;
        onFileSelect();
    }
}

function onFileSelect()
{
    const select = document.getElementById("fileList");
    const file = select.value;

    if (!file) return;

    currentFile = file;
    document.getElementById("saveBtn").disabled = false;

    readFileFromServer(file);
}

const DELIM = "=====CAKE-OUTPUT=====";

async function readFileFromServer(file)
{
    const res = await fetch(
        `${API}/read?path=${encodeURIComponent(currentPath)}&file=${encodeURIComponent(file)}`
    );

    const text = await res.text();

    const parts = text.split(DELIM);

    document.getElementById("c-editor").value = parts[0] || "";
    var s = highlightC(editor.value) + "\n";

    var a = parseCompilerLines(parts[1] || "");

    var h = renderOutput(parts[1] || "");
    document.getElementById("output").innerHTML = h;// = parts[1] || "";

    highlight.innerHTML = appendMessagesToLines(s, a);
    updateGutter();

}

async function loadFile(path, file)
{
    const res = await fetch(
        `${API}/file?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}`
    );

    const text = await res.text();
    document.getElementById("c-editor").value = text;
}


async function saveFile()
{
    if (!currentFile) return;

    const content = document.getElementById("c-editor").value;

    const res = await fetch(`${API}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: currentFile + "\n" + content
    }
    );

    // ✅ read server response (file content after save)
    const returnedText = await res.text();

    // optional: replace editor content with what server read
    document.getElementById("c-editor").value = returnedText;

    alert("Saved (verified)");
}


async function compile()
{
    if (!currentFile) return;

    const content = document.getElementById("c-editor").value;

    const res = await fetch(`${API}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: currentFile + "\n" + content
    }
    );

    // ✅ read server response (file content after save)
    const returnedText = await res.text();

    const parts = returnedText.split(DELIM);

    document.getElementById("c-editor").value = parts[0] || "";
    highlight.innerHTML = highlightC(editor.value) + "\n";
    updateGutter();

    var h = renderOutput(parts[1] || "");
    document.getElementById("output").innerHTML = h;// = parts[1] || "";
}

const ANSI_FG = ['#4e4e4e', '#e74c3c', '#2ecc71', '#f1c40f', '#3498db', '#9b59b6', '#1abc9c', '#ecf0f1'];
const ANSI_BG = ['#1e1e1e', '#c0392b', '#27ae60', '#d4ac0d', '#2980b9', '#8e44ad', '#17a589', '#bdc3c7'];
const ANSI_FG_BRIGHT = ['#888888', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff'];

function escHtml(s)
{
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderOutput(text)
{
    let fg = null, bg = null, bold = false, dim = false, italic = false, underline = false;
    let html = '';
    const re = /\[([0-9;]*)m/g;
    let last = 0, m;

    function openSpan()
    {
        const styles = [];
        if (bold) styles.push('font-weight:bold');
        if (dim) styles.push('opacity:0.5');
        if (italic) styles.push('font-style:italic');
        if (underline) styles.push('text-decoration:underline');
        if (fg) styles.push('color:' + fg);
        if (bg) styles.push('background:' + bg);
        if (styles.length) html += '<span style="' + styles.join(';') + "\">";
        return styles.length > 0;
    }

    function applyCode(c)
    {
        if (c === 0) { fg = bg = null; bold = dim = italic = underline = false; }
        else if (c === 1) bold = true;
        else if (c === 2) dim = true;
        else if (c === 3) italic = true;
        else if (c === 4) underline = true;
        else if (c === 22) { bold = false; dim = false; }
        else if (c === 23) italic = false;
        else if (c === 24) underline = false;
        else if (c >= 30 && c <= 37) fg = ANSI_FG[c - 30];
        else if (c === 39) fg = null;
        else if (c >= 40 && c <= 47) bg = ANSI_BG[c - 40];
        else if (c === 49) bg = null;
        else if (c >= 90 && c <= 97) fg = ANSI_FG_BRIGHT[c - 90];
        else if (c >= 100 && c <= 107) bg = ANSI_FG_BRIGHT[c - 100];
    }

    while ((m = re.exec(text)) !== null)
    {
        const plain = text.slice(last, m.index);
        if (plain)
        {
            const hasSpan = openSpan();
            html += escHtml(plain);
            if (hasSpan) html += '</span>';
        }
        last = m.index + m[0].length;
        (m[1] === '' ? [0] : m[1].split(';').map(Number)).forEach(applyCode);
    }

    const tail = text.slice(last);
    if (tail)
    {
        const hasSpan = openSpan();
        html += escHtml(tail);
        if (hasSpan) html += '</span>';
    }
    return html;
    //document.getElementById('output').innerHTML = html;
}
function appendToLine(text, targetLine, htmlToAppend)
{
    let line = 1;
    let i = 0;
    let start = 0;

    // find start of target line
    while (i < text.length)
    {
        if (line === targetLine)
        {
            start = i;
            break;
        }

        if (text[i] === '\n')
        {
            line++;
        }
        i++;
    }

    // if line not found, return original
    if (line !== targetLine) return text;

    // find end of the line
    let end = start;
    while (end < text.length && text[end] !== '\n')
    {
        end++;
    }

    // split and insert
    const before = text.slice(0, end);
    const after = text.slice(end);

    return before + htmlToAppend + after;
}
function appendMessagesToLines(input, messages)
{
    const lines = input.split('\n');
    const result = [];

    let msgIndex = 0;

    for (let i = 0; i < lines.length; i++)
    {
        let line = lines[i];
        const currentLineNumber = i + 1;

        // process all messages that match this line
        while (
            msgIndex < messages.length &&
            messages[msgIndex].line === currentLineNumber
        )
        {
            line += " // " + messages[msgIndex].text;
            msgIndex++;
        }

        result.push(line);
    }

    return result.join('\n');
}
function parseCompilerLines(input)
{
    const result = [];
    const lines = input.split('\n');

    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i];

        // find ".c:"
        const dotC = line.indexOf(".c\x1b[97m:");
        if (dotC === -1) continue;

        let pos = dotC + 3; // after ".c:"

        // parse line number
        let lineNumber = 0;
        let hasDigits = false;

        while (pos < line.length)
        {
            const ch = line.charCodeAt(pos);
            if (ch >= 48 && ch <= 57)
            { // '0'..'9'
                hasDigits = true;
                lineNumber = lineNumber * 10 + (ch - 48);
                pos++;
            } else
            {
                break;
            }
        }

        if (!hasDigits) continue;
        if (line[pos] !== ':') continue;

        pos++; // skip ':'

        // skip column number (digits)
        while (pos < line.length)
        {
            const ch = line.charCodeAt(pos);
            if (ch >= 48 && ch <= 57)
            {
                pos++;
            } else
            {
                break;
            }
        }

        if (line[pos] !== ':') continue;
        pos++; // skip ':'

        // skip space if present
        if (line[pos] === ' ') pos++;

        // rest is message
        const message = line.substring(pos);

        result.push({
            line: lineNumber,
            text: message
        });
    }

    return result;
}

function highlightC(code)
{
    code = escHtml(code);


    // strings
    code = code.replace(/("(?:\\.|[^"])*")/g, '<span class="str">$1</span>');

    // comments
    code = code.replace(/(\/\/.*)/g, '<span class="com">$1</span>');
    code = code.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="com">$1</span>');

    // keywords
    const kw = /\b(int|char|return|if|else|for|while|void|struct|typedef|const|static)\b/g;
    code = code.replace(kw, '<span class="kw">$1</span>');

    // numbers
    code = code.replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
    //code = appendToLine(code, 10, "<span style=\"background-color:yellow\">TEST</span>");
    return code;
}

const editor = document.getElementById("c-editor");
const highlight = document.getElementById("highlight");
const gutter = document.getElementById("gutter");
const gutterInner = document.getElementById("gutter-inner");

function updateGutter()
{
    const lines = editor.value.split("\n").length;
    const nums = [];
    for (let i = 1; i <= lines; i++) nums.push(i);
    gutterInner.textContent = nums.join("\n");
}

function updateHighlight()
{
    highlight.innerHTML = highlightC(editor.value);
    updateGutter();
}

// update on typing
editor.addEventListener("input", updateHighlight);

// initialize on load
updateHighlight();

// sync scroll
editor.addEventListener("scroll", () =>
{
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
    gutterInner.style.transform = `translateY(-${editor.scrollTop}px)`;
});

// double-click output line to jump to editor line
document.getElementById("output").addEventListener("dblclick", () =>
{
    const selection = window.getSelection();
    if (!selection) return;

    // get the text of the line that was double-clicked
    let node = selection.anchorNode;
    if (!node) return;

    // walk up to get full line text
    const lineText = node.textContent || "";

    // match pattern: anything ending in .c:LINE:COL: or .c:LINE:
    const match = lineText.match(/:(\d+):/);
    if (!match) return;

    const targetLine = parseInt(match[1], 10);
    if (!targetLine || targetLine < 1) return;

    jumpToLine(targetLine);
});

function jumpToLine(lineNumber)
{
    const lines = editor.value.split("\n");
    if (lineNumber > lines.length) return;

    // calculate char offset to start of that line
    let offset = 0;
    for (let i = 0; i < lineNumber - 1; i++)
    {
        offset += lines[i].length + 1; // +1 for \n
    }

    // set cursor at start of target line
    editor.focus();
    editor.setSelectionRange(offset, offset + lines[lineNumber - 1].length);

    // scroll editor so the line is vertically centered
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    const editorHeight = editor.clientHeight;
    const targetScrollTop = (lineNumber - 1) * lineHeight - editorHeight / 2 + lineHeight / 2;
    editor.scrollTop = Math.max(0, targetScrollTop);

    // sync highlight and gutter
    highlight.scrollTop = editor.scrollTop;
    gutterInner.style.transform = `translateY(-${editor.scrollTop}px)`;
}