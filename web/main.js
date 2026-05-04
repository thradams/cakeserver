const API = "http://localhost:8080";

let currentPath = "";
let currentFile = "";
let lastMessages = [];   // list of { line, text } — rebuilt whenever a file loads or compiles
let diagIndex = -1;      // index into lastMessages for Prev/Next navigation

function setDiagMessages(messages)
{
    lastMessages = messages;
    diagIndex = messages.length > 0 ? 0 : -1;
    updateDiagCounter();
}

function updateDiagCounter()
{
    const counter = document.getElementById("diagCounter");
    if (!counter) return;
    if (lastMessages.length === 0)
    {
        counter.textContent = "";
    }
    else
    {
        counter.textContent = `${diagIndex + 1}/${lastMessages.length}`;
    }

    // sync selected highlight in output panel
    document.querySelectorAll(".output-diag.selected").forEach(el => el.classList.remove("selected"));
    if (diagIndex >= 0 && diagIndex < lastMessages.length)
    {
        const targetLine = lastMessages[diagIndex].line;
        const el = document.querySelector(`.output-diag[data-line="${targetLine}"]`);
        if (el)
        {
            el.classList.add("selected");
            el.scrollIntoView({ block: "nearest" });
        }
    }
}

function diagNext()
{
    if (lastMessages.length === 0) return;
    diagIndex = (diagIndex + 1) % lastMessages.length;
    updateDiagCounter();
    jumpToLine(lastMessages[diagIndex].line);
}

function diagPrev()
{
    if (lastMessages.length === 0) return;
    diagIndex = (diagIndex - 1 + lastMessages.length) % lastMessages.length;
    updateDiagCounter();
    jumpToLine(lastMessages[diagIndex].line);
}

function diagFirst()
{
    if (lastMessages.length === 0) return;
    diagIndex = 0;
    updateDiagCounter();
    jumpToLine(lastMessages[diagIndex].line);
}

function diagLast()
{
    if (lastMessages.length === 0) return;
    diagIndex = lastMessages.length - 1;
    updateDiagCounter();
    jumpToLine(lastMessages[diagIndex].line);
}

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
    setDiagMessages(a);

    var h = renderOutput(parts[1] || "");
    document.getElementById("output").innerHTML = h;

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

    await fetch(`${API}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: currentFile + "\n" + content
    });

    alert("Saved");
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
    var s = highlightC(editor.value) + "\n";
    var a = parseCompilerLines(parts[1] || "");
    setDiagMessages(a);
    highlight.innerHTML = appendMessagesToLines(s, a);
    updateGutter();

    var h = renderOutput(parts[1] || "");
    document.getElementById("output").innerHTML = h;
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
    // render one raw ANSI line into an HTML string
    function renderLine(raw)
    {
        let fg = null, bg = null, bold = false, dim = false, italic = false, underline = false;
        let html = '';
        const re = /\x1b\[([0-9;]*)m/g;
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
            if (styles.length) html += '<span style="' + styles.join(';') + '">';
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

        while ((m = re.exec(raw)) !== null)
        {
            const plain = raw.slice(last, m.index);
            if (plain) { const h = openSpan(); html += escHtml(plain); if (h) html += '</span>'; }
            last = m.index + m[0].length;
            (m[1] === '' ? [0] : m[1].split(';').map(Number)).forEach(applyCode);
        }

        const tail = raw.slice(last);
        if (tail) { const h = openSpan(); html += escHtml(tail); if (h) html += '</span>'; }

        return html;
    }

    // split into raw lines, wrap every line in a span so CSS can target blank ones
    const rawLines = text.split('\n');
    let html = '';

    for (const raw of rawLines)
    {
        const stripped = raw.replace(/\x1b\[[0-9;]*m/g, '').trim();

        if (!stripped) continue;

        const diagMatch = stripped.match(/\w+\.c:(\d+):\d+:\s*(warning|error|note)/);

        if (diagMatch)
        {
            const lineNum = parseInt(diagMatch[1], 10);
            html += `<span class="output-line output-diag" data-line="${lineNum}" onclick="outputDiagClick(this)">${renderLine(raw)}</span>`;
        }
        else
        {
            html += `<span class="output-line">${renderLine(raw)}</span>`;
        }
    }

    return html;
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
    const sorted = [...messages].sort((a, b) => a.line - b.line);

    const lines = input.split('\n');
    const result = [];

    let msgIndex = 0;

    for (let i = 0; i < lines.length; i++)
    {
        let line = lines[i];
        const currentLineNumber = i + 1;

        while (msgIndex < sorted.length && sorted[msgIndex].line === currentLineNumber)
        {
            const msg = sorted[msgIndex];

            let cls, icon;
            if (msg.severity === 'error') { cls = 'diag-error'; icon = '\u2716 '; }
            else if (msg.severity === 'warning') { cls = 'diag-warning'; icon = '\u26a0 '; }
            else { cls = 'diag-note'; icon = '\u25cf '; }

            line += `<span class="${cls}">${icon}${escHtml(msg.text)}</span>`;
            msgIndex++;
        }

        result.push(line);
    }

    return result.join('\n');
}
function stripAnsi(str)
{
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function parseCompilerLines(input)
{
    const result = [];
    const seen = new Set();
    const lines = input.split('\n');

    for (let i = 0; i < lines.length; i++)
    {
        const clean = stripAnsi(lines[i]);

        // match: file.c:LINE:COL: (warning|error|note) [optional code:] message
        const m = clean.match(/\w+\.c:(\d+):\d+:\s*(warning|error|note)[^:]*:\s*(.*)/);
        if (!m) continue;

        const lineNumber = parseInt(m[1], 10);
        const severity = m[2].toLowerCase();   // "warning" | "error" | "note"
        const message = m[3].trim();

        if (!lineNumber || !message) continue;

        // deduplicate: same line + severity + message
        const key = `${lineNumber}|${severity}|${message}`;
        if (seen.has(key)) continue;
        seen.add(key);

        result.push({
            line: lineNumber,
            severity,              // used by appendMessagesToLines and navigation
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
    var s = highlightC(editor.value) + "\n";
    highlight.innerHTML = appendMessagesToLines(s, lastMessages);
    updateGutter();
}

// update on typing
editor.addEventListener("input", updateHighlight);

// initialize on load
updateHighlight();

// textarea scroll drives highlight scroll (both axes) and gutter
editor.addEventListener("scroll", () =>
{
    highlight.scrollLeft = editor.scrollLeft;
    highlight.scrollTop = editor.scrollTop;
    gutterInner.style.transform = `translateY(-${editor.scrollTop}px)`;
});

// wheel on editor forwards scroll to highlight (vertical and horizontal)
editor.addEventListener("wheel", (e) =>
{
    highlight.scrollTop += e.deltaY;
    highlight.scrollLeft += e.deltaX;
    editor.scrollTop = highlight.scrollTop;
    editor.scrollLeft = highlight.scrollLeft;
    gutterInner.style.transform = `translateY(-${highlight.scrollTop}px)`;
}, { passive: true });

// measure actual scrollbar width and adjust textarea to expose it
(function adjustForScrollbar()
{
    const scrollbarWidth = highlight.offsetWidth - highlight.clientWidth;
    const w = scrollbarWidth > 0 ? scrollbarWidth : 17;
    editor.style.width = `calc(100% - ${w}px)`;

    const proxy = document.getElementById("scrollbar-proxy");
    proxy.style.width = w + "px";

    // make proxy a real scrollable with same scroll height as highlight
    // so its native scrollbar works, then sync both ways
    const inner = document.createElement("div");
    inner.style.height = highlight.scrollHeight + "px";
    inner.style.width = "1px";
    proxy.appendChild(inner);
    proxy.style.overflowY = "scroll";
    proxy.style.overflowX = "hidden";

    let fromProxy = false;
    let fromHighlight = false;

    proxy.addEventListener("scroll", () =>
    {
        if (fromHighlight) return;
        fromProxy = true;
        highlight.scrollTop = proxy.scrollTop;
        editor.scrollTop = proxy.scrollTop;
        gutterInner.style.transform = `translateY(-${proxy.scrollTop}px)`;
        fromProxy = false;
    });

    highlight.addEventListener("scroll", () =>
    {
        if (fromProxy) return;
        fromHighlight = true;
        proxy.scrollTop = highlight.scrollTop;
        fromHighlight = false;
    });

    // horizontal scrollbar proxy
    const proxyX = document.getElementById("scrollbar-proxy-x");
    const innerX = document.createElement("div");
    innerX.style.width = highlight.scrollWidth + "px";
    innerX.style.height = "1px";
    proxyX.appendChild(innerX);
    proxyX.style.overflowX = "scroll";
    proxyX.style.overflowY = "hidden";

    let fromProxyX = false;
    let fromHighlightX = false;

    proxyX.addEventListener("scroll", () =>
    {
        if (fromHighlightX) return;
        fromProxyX = true;
        highlight.scrollLeft = proxyX.scrollLeft;
        editor.scrollLeft = proxyX.scrollLeft;
        fromProxyX = false;
    });

    highlight.addEventListener("scroll", () =>
    {
        if (fromProxyX) return;
        fromHighlightX = true;
        proxyX.scrollLeft = highlight.scrollLeft;
        fromHighlightX = false;
    });

    // keep inner dimensions in sync when content changes
    const mo = new MutationObserver(() =>
    {
        inner.style.height = highlight.scrollHeight + "px";
        innerX.style.width = highlight.scrollWidth + "px";
    });
    mo.observe(highlight, { childList: true, subtree: true, characterData: true });
})();

// click a diagnostic line in the output panel
function outputDiagClick(el)
{
    // clear previous selection
    const prev = document.querySelector(".output-diag.selected");
    if (prev) prev.classList.remove("selected");
    el.classList.add("selected");

    const targetLine = parseInt(el.dataset.line, 10);
    if (!targetLine || targetLine < 1) return;

    // sync diagIndex to the matching entry in lastMessages
    const idx = lastMessages.findIndex(m => m.line === targetLine);
    if (idx !== -1)
    {
        diagIndex = idx;
        updateDiagCounter();
    }

    jumpToLine(targetLine);
}

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
    const viewHeight = editor.clientHeight;
    const targetScrollTop = (lineNumber - 1) * lineHeight - viewHeight / 2 + lineHeight / 2;
    editor.scrollTop = Math.max(0, targetScrollTop);

    // sync highlight and gutter
    highlight.scrollTop = editor.scrollTop;
    gutterInner.style.transform = `translateY(-${editor.scrollTop}px)`;
}

// Auto-load on page start
window.addEventListener("load", loadFiles);

// Ctrl+S to save; F8 / Shift+F8 for diag navigation
document.addEventListener("keydown", (e) =>
{
    if (e.ctrlKey && e.key === 's')
    {
        e.preventDefault();
        saveFile();
    }
    else if (e.key === 'F8')
    {
        e.preventDefault();
        if (e.shiftKey) diagPrev(); else diagNext();
    }
});
const resizeHandle = document.getElementById("editor-resize-handle");
const editorView = document.querySelector(".editor-view");

resizeHandle.addEventListener("mousedown", (e) =>
{
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorView.offsetHeight;

    function onMouseMove(e)
    {
        const newHeight = Math.max(100, startHeight + e.clientY - startY);
        editorView.style.height = newHeight + "px";
    }

    function onMouseUp()
    {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
});