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
    highlight.innerHTML = highlightC(editor.value) + "\n";

    var h = renderOutput(parts[1] || "");
    document.getElementById("output").innerHTML = h;// = parts[1] || "";
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

    return code;
}

const editor = document.getElementById("c-editor");
const highlight = document.getElementById("highlight");

function updateHighlight()
{
    highlight.innerHTML = highlightC(editor.value);
}

// update on typing
editor.addEventListener("input", updateHighlight);

// sync scroll
editor.addEventListener("scroll", () =>
{
    highlight.scrollTop = editor.scrollTop;
    highlight.scrollLeft = editor.scrollLeft;
});
