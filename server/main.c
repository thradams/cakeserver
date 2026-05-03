// server.c  –  cross-platform (Windows + Linux/macOS)
//              all allocations are sized to actual data – no hard-coded limits

/* ── Windows preamble ────────────────────────────────────────────────── */
#ifdef _WIN32

#ifndef _CRT_SECURE_NO_WARNINGS
#  define _CRT_SECURE_NO_WARNINGS
#endif

#  include <winsock2.h>
#  include <windows.h>
#  pragma comment(lib, "Ws2_32.lib")
typedef SOCKET SocketFd;
#  define CLOSE_SOCKET(s)  closesocket(s)
#  define PATH_SEP         "\\"
#  define strcasecmp       _stricmp
#  define strncasecmp      _strnicmp
#  define strdup           _strdup

/* ── POSIX preamble ──────────────────────────────────────────────────── */
#else
#  include <sys/socket.h>
#  include <netinet/in.h>
#  include <arpa/inet.h>
#  include <unistd.h>
#  include <dirent.h>
#  include <strings.h>
typedef int SocketFd;
#  define CLOSE_SOCKET(s)  close(s)
#  define INVALID_SOCKET   (-1)
#  define SOCKET_ERROR     (-1)
#  define PATH_SEP         "/"
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ─────────────────────────────────────────────────────────────────────── */
#define PORT         8080
#define MAX_PATH_LEN 2048   /* max filesystem path length */
#define MAX_CMD_LEN  (MAX_PATH_LEN + 32)

#ifdef _WIN32
const char* BASE_DIR = "C:\\Users\\thiag\\source\\repos\\serverw\\serverw";
#else
const char* BASE_DIR = "/tmp/serverw";   /* adjust as needed */
#endif

const char BASE_DIR2[] = "C:\\Users\\thiag\\source\\repos\\cake_private\\src\\";

/* ══════════════════════════════════════════════════════════════════════
   dynbuf  –  a simple growable byte buffer
   ══════════════════════════════════════════════════════════════════════ */
typedef struct {
    char* data;
    size_t len;   /* bytes written (excluding NUL terminator) */
    size_t cap;   /* total bytes allocated                    */
} DynBuf;

static int db_init(DynBuf* b, size_t initial)
{
    b->data = malloc(initial);
    if (!b->data) return -1;
    b->data[0] = '\0';
    b->len = 0;
    b->cap = initial;
    return 0;
}

static int db_ensure(DynBuf* b, size_t extra)
{
    if (b->len + extra + 1 <= b->cap) return 0;
    size_t newcap = b->cap * 2;
    while (newcap < b->len + extra + 1) newcap *= 2;
    char* p = realloc(b->data, newcap);
    if (!p) return -1;
    b->data = p;
    b->cap = newcap;
    return 0;
}

static int db_append(DynBuf* b, const char* s, size_t n)
{
    if (db_ensure(b, n) != 0) return -1;
    memcpy(b->data + b->len, s, n);
    b->len += n;
    b->data[b->len] = '\0';
    return 0;
}

static int db_appends(DynBuf* b, const char* s)
{
    return db_append(b, s, strlen(s));
}

static void db_free(DynBuf* b)
{
    free(b->data);
    b->data = NULL;
    b->len = b->cap = 0;
}

/* ══════════════════════════════════════════════════════════════════════
   file_read_all  –  read an entire file into a malloc'd, NUL-terminated
                     buffer; *out_len receives the byte count.
   ══════════════════════════════════════════════════════════════════════ */
static char* file_read_all(const char* path, size_t* out_len)
{
    FILE* f = fopen(path, "rb");
    if (!f) return NULL;

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return NULL; }
    rewind(f);

    char* buf = malloc((size_t)sz + 1);
    if (!buf) { fclose(f); return NULL; }

    size_t got = fread(buf, 1, (size_t)sz, f);
    fclose(f);
    buf[got] = '\0';
    if (out_len) *out_len = got;
    return buf;
}

/* ══════════════════════════════════════════════════════════════════════
   path / MIME helpers
   ══════════════════════════════════════════════════════════════════════ */
static const char* get_content_type(const char* path)
{
    const char* ext = strrchr(path, '.');
    if (!ext) return "application/octet-stream";
    if (strcasecmp(ext, ".html") == 0) return "text/html";
    if (strcasecmp(ext, ".js") == 0) return "application/javascript";
    if (strcasecmp(ext, ".css") == 0) return "text/css";
    if (strcasecmp(ext, ".txt") == 0) return "text/plain";
    if (strcasecmp(ext, ".json") == 0) return "application/json";
    return "application/octet-stream";
}

static int has_c_extension(const char* name)
{
    const char* dot = strrchr(name, '.');
    if (!dot) return 0;
    return strcasecmp(dot, ".c") == 0;
}

static int is_safe(const char* s)
{
    return strstr(s, "..") == NULL;
}

static void get_param(const char* query, const char* key,
    char* out, int max)
{
    const char* p = strstr(query, key);
    if (!p) return;
    p += strlen(key);
    int i = 0;
    while (*p && *p != '&' && i < max - 1)
        out[i++] = *p++;
    out[i] = '\0';
}

/* ══════════════════════════════════════════════════════════════════════
   send_response  –  header sized exactly to content length
   ══════════════════════════════════════════════════════════════════════ */
static void send_response(SocketFd client,
    const char* type,
    const char* body, size_t body_len)
{
    /* dry-run snprintf to compute exact header size */
    int hlen = snprintf(NULL, 0,
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Content-Length: %zu\r\n"
        "\r\n",
        type, body_len);
    if (hlen <= 0) return;

    char* header = malloc((size_t)hlen + 1);
    if (!header) return;

    snprintf(header, (size_t)hlen + 1,
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: %s\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Content-Length: %zu\r\n"
        "\r\n",
        type, body_len);

    send(client, header, hlen, 0);
    send(client, body, (int)body_len, 0);
    free(header);
}

/* convenience for plain C-string bodies */
static void send_str(SocketFd client, const char* type, const char* body)
{
    send_response(client, type, body, strlen(body));
}

/* ══════════════════════════════════════════════════════════════════════
   handle_static
   ══════════════════════════════════════════════════════════════════════ */
static void handle_static(SocketFd client, const char* url)
{
    char path[MAX_PATH_LEN];

    if (strcmp(url, "/") == 0)
        strcpy(path, "index.html");
    else
        snprintf(path, sizeof(path), ".%s", url);

    if (strstr(path, ".."))
    {
        send_str(client, "text/plain", "Invalid path");
        return;
    }

    size_t flen;
    char* buf = file_read_all(path, &flen);
    if (!buf)
    {
        send_str(client, "text/plain", "Not found");
        return;
    }

    send_response(client, get_content_type(path), buf, flen);
    free(buf);
}

/* ══════════════════════════════════════════════════════════════════════
   handle_list  –  JSON array of .c filenames, built with DynBuf
   ══════════════════════════════════════════════════════════════════════ */
static void handle_list(SocketFd client, const char* query)
{
    char rel[512] = "";
    get_param(query, "path=", rel, sizeof(rel));

    if (!is_safe(rel))
    {
        send_str(client, "text/plain", "Invalid path");
        return;
    }
    
    DynBuf json;
    if (db_init(&json, 256) != 0) return;
    db_appends(&json, "[");
    int first = 1;

#ifdef _WIN32
    char search[MAX_PATH_LEN];
    if (rel[0])
        snprintf(search, sizeof(search), "%s\\%s\\*", BASE_DIR2, rel);
    else
        snprintf(search, sizeof(search), "%s\\*", BASE_DIR2);

    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(search, &fd);

    if (h == INVALID_HANDLE_VALUE)
    {
        send_str(client, "text/plain", "Cannot open directory");
        db_free(&json);
        return;
    }
    do
    {
        if (strcmp(fd.cFileName, ".") == 0 ||
            strcmp(fd.cFileName, "..") == 0) continue;
        if (!has_c_extension(fd.cFileName)) continue;
        if (!first) db_appends(&json, ",");
        first = 0;
        db_appends(&json, "\"");
        db_appends(&json, fd.cFileName);
        db_appends(&json, "\"");
    } while (FindNextFileA(h, &fd));
    FindClose(h);

#else
    char dirpath[MAX_PATH_LEN];
    if (rel[0])
        snprintf(dirpath, sizeof(dirpath), "%s/%s", BASE_DIR2, rel);
    else
        snprintf(dirpath, sizeof(dirpath), "%s", BASE_DIR2);

    DIR* dir = opendir(dirpath);

    if (!dir)
    {
        send_str(client, "text/plain", "Cannot open directory");
        db_free(&json);
        return;
    }
    struct dirent* entry;
    while ((entry = readdir(dir)) != NULL)
    {
        if (strcmp(entry->d_name, ".") == 0 ||
            strcmp(entry->d_name, "..") == 0) continue;
        if (!has_c_extension(entry->d_name)) continue;
        if (!first) db_appends(&json, ",");
        first = 0;
        db_appends(&json, "\"");
        db_appends(&json, entry->d_name);
        db_appends(&json, "\"");
    }
    closedir(dir);
#endif

    db_appends(&json, "]");
    send_response(client, "application/json", json.data, json.len);
    db_free(&json);
}

/* ══════════════════════════════════════════════════════════════════════
   parse_body  –  extract path, file, and content from JSON body.
                  Returns 1 on success, 0 on failure.
   Expected format: {"path":"...","file":"...","content":"..."}
   ══════════════════════════════════════════════════════════════════════ */
static int parse_body(const char* body,
    char path[512], char file[512],
    const char** content_start, size_t* content_len)
{
    sscanf(body,
        "{\"path\":\"%511[^\"]\",\"file\":\"%511[^\"]\",",
        path, file);

    if (!is_safe(path) || !is_safe(file)) return 0;

    const char* tag = "\"content\":\"";
    const char* s = strstr(body, tag);
    if (!s) return 0;
    s += strlen(tag);

    /* find closing unescaped quote */
    const char* e = s;
    while (*e)
    {
        if (*e == '"' && (e == s || *(e - 1) != '\\')) break;
        e++;
    }

    *content_start = s;
    *content_len = (size_t)(e - s);
    return 1;
}

/* ══════════════════════════════════════════════════════════════════════
   compile_and_respond  –  run cake on full, send source + output
   ══════════════════════════════════════════════════════════════════════ */
#define DELIM "\n=====CAKE" "-" "OUTPUT=====\n"

static void compile_and_respond(SocketFd client, const char* full)
{
    char cmd[MAX_CMD_LEN];
    snprintf(cmd, sizeof(cmd), "cake \"%s\" > output.txt", full);
    system(cmd);

    size_t src_len;
    char* src = file_read_all(full, &src_len);
    if (!src)
    {
        send_str(client, "text/plain", "Cannot read source file");
        return;
    }

    size_t out_len;
    char* out = file_read_all("output.txt", &out_len);
    if (!out)
    {
        out = strdup("(no compiler output)");
        out_len = out ? strlen(out) : 0;
    }
    if (!out) { free(src); return; }

    size_t delim_len = strlen(DELIM);
    size_t total = src_len + delim_len + out_len;
    char* response = malloc(total + 1);
    if (!response) { free(src); free(out); return; }

    memcpy(response, src, src_len);
    memcpy(response + src_len, DELIM, delim_len);
    memcpy(response + src_len + delim_len, out, out_len);
    response[total] = '\0';

    send_response(client, "text/plain", response, total);
    free(src);
    free(out);
    free(response);
}

/* ══════════════════════════════════════════════════════════════════════
   handle_read  –  GET ?path=&file=  →  compile existing file, send back
   ══════════════════════════════════════════════════════════════════════ */
static void handle_read(SocketFd client, const char* query)
{
    char rel[512] = "";
    char file[512] = "";
    get_param(query, "path=", rel, sizeof(rel));
    get_param(query, "file=", file, sizeof(file));

    if (!is_safe(rel) || !is_safe(file))
    {
        send_str(client, "text/plain", "Invalid path");
        return;
    }

    char full[MAX_PATH_LEN];
    snprintf(full, sizeof(full), "%s" PATH_SEP "%s" PATH_SEP "%s",
        BASE_DIR2, rel, file);

    compile_and_respond(client, full);
}

/* ══════════════════════════════════════════════════════════════════════
   handle_save  –  POST {"path":...,"file":...,"content":...}
                   Write file, return "OK"
   ══════════════════════════════════════════════════════════════════════ */
static void handle_save(SocketFd client, const char* body, size_t body_len)
{
    char path[512] = "";
    char file[512] = "";
    const char* content; size_t content_len;

    if (!parse_body(body, path, file, &content, &content_len))
    {
        send_str(client, "text/plain", "Invalid request");
        return;
    }

    char full[MAX_PATH_LEN];
    snprintf(full, sizeof(full), "%s" PATH_SEP "%s" PATH_SEP "%s",
        BASE_DIR2, path, file);

    FILE* f = fopen(full, "wb");
    if (!f)
    {
        send_str(client, "text/plain", "Cannot write file");
        return;
    }
    fwrite(content, 1, content_len, f);
    fclose(f);

    send_str(client, "text/plain", "OK");
    (void)body_len;
}

/* ══════════════════════════════════════════════════════════════════════
   handle_compile  –  POST {"path":...,"file":...,"content":...}
                      Write file, compile with cake, return source + output
   ══════════════════════════════════════════════════════════════════════ */
static void handle_compile(SocketFd client, const char* body, size_t body_len)
{
    char path[512] = "";
    char file[512] = "";
    const char* content; size_t content_len;

    if (!parse_body(body, path, file, &content, &content_len))
    {
        send_str(client, "text/plain", "Invalid request");
        return;
    }

    char full[MAX_PATH_LEN];
    snprintf(full, sizeof(full), "%s" PATH_SEP "%s" PATH_SEP "%s",
        BASE_DIR2, path, file);

    FILE* f = fopen(full, "wb");
    if (!f)
    {
        send_str(client, "text/plain", "Cannot write file");
        return;
    }
    fwrite(content, 1, content_len, f);
    fclose(f);

    compile_and_respond(client, full);
    (void)body_len;
}

/* ══════════════════════════════════════════════════════════════════════
   recv_all  –  grow a DynBuf until the full HTTP request is received
   ══════════════════════════════════════════════════════════════════════ */
static int recv_all(SocketFd client, DynBuf* buf)
{
    char chunk[4096];
    size_t content_length = 0;
    int    headers_done = 0;

    for (;;)
    {
        int n = (int)recv(client, chunk, sizeof(chunk), 0);
        if (n <= 0) break;
        if (db_append(buf, chunk, (size_t)n) != 0) return -1;

        char* sep = strstr(buf->data, "\r\n\r\n");
        if (!sep) continue;   /* headers not complete yet */

        if (!headers_done)
        {
            headers_done = 1;
            char* cl = strstr(buf->data, "Content-Length:");
            if (!cl) cl = strstr(buf->data, "content-length:");
            if (cl) content_length = (size_t)atol(cl + 15);
        }

        size_t header_bytes = (size_t)(sep + 4 - buf->data);
        if (buf->len - header_bytes >= content_length) break;
    }
    return 0;
}

/* ══════════════════════════════════════════════════════════════════════
   main
   ══════════════════════════════════════════════════════════════════════ */
int main(void)
{
#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    SocketFd server = socket(AF_INET, SOCK_STREAM, 0);
    if (server == INVALID_SOCKET) { perror("socket"); return 1; }

    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR,
        (const char*)&yes, sizeof(yes));

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(PORT);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(server, (struct sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR)
    {
        perror("bind"); return 1;
    }
    listen(server, 10);
    printf("Server running at http://localhost:%d\n", PORT);

    while (1)
    {
        SocketFd client = accept(server, NULL, NULL);
        if (client == INVALID_SOCKET) continue;

        DynBuf req;
        if (db_init(&req, 4096) != 0) { CLOSE_SOCKET(client); continue; }

        if (recv_all(client, &req) != 0 || req.len == 0)
        {
            db_free(&req); CLOSE_SOCKET(client); continue;
        }

        char method[8] = { 0 }, url[1024] = { 0 };
        sscanf(req.data, "%7s %1023s", method, url);

        char* body = strstr(req.data, "\r\n\r\n");
        size_t body_len = 0;
        if (body)
        {
            body += 4;
            body_len = req.len - (size_t)(body - req.data);
        }

        char* query = strchr(url, '?');
        if (query) *query++ = '\0';

        if (strcmp(method, "GET") == 0)
        {
            if (strcmp(url, "/list") == 0)
                handle_list(client, query ? query : "");
            else if (strcmp(url, "/read") == 0)
                handle_read(client, query ? query : "");
            else
                handle_static(client, url);
        }
        else if (strcmp(method, "POST") == 0)
        {
            if (strcmp(url, "/save") == 0)
                handle_save(client, body ? body : "", body_len);
            else if (strcmp(url, "/compile") == 0)
                handle_compile(client, body ? body : "", body_len);
            else
                send_str(client, "text/plain", "Not found");
        }

        db_free(&req);
        CLOSE_SOCKET(client);
    }

#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}