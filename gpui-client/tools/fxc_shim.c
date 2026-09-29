#include <windows.h>
#include <stdio.h>
#include <string.h>

typedef interface ID3D10Blob ID3DBlob;
typedef struct ID3D10BlobVtbl {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(ID3DBlob *This, REFIID riid, void **ppvObject);
    ULONG   (STDMETHODCALLTYPE *AddRef)(ID3DBlob *This);
    ULONG   (STDMETHODCALLTYPE *Release)(ID3DBlob *This);
    LPVOID  (STDMETHODCALLTYPE *GetBufferPointer)(ID3DBlob *This);
    SIZE_T  (STDMETHODCALLTYPE *GetBufferSize)(ID3DBlob *This);
} ID3D10BlobVtbl;

struct ID3D10Blob {
    const ID3D10BlobVtbl *lpVtbl;
};

typedef HRESULT (WINAPI *PFN_D3DCompileFromFile)(
    LPCWSTR pFileName,
    const void *pDefines,
    void *pInclude,
    LPCSTR pEntrypoint,
    LPCSTR pTarget,
    UINT Flags1,
    UINT Flags2,
    ID3DBlob **ppCode,
    ID3DBlob **ppErrorMsgs
);

#define D3D_COMPILE_STANDARD_FILE_INCLUDE ((void*)(UINT_PTR)1)
#define D3DCOMPILE_OPTIMIZATION_LEVEL3 (1 << 15)

int main(int argc, char **argv) {
    const char *target = NULL;
    const char *entry = NULL;
    const char *out_header = NULL;
    const char *var_name = "g_shader";
    const char *shader_path = NULL;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "/T") == 0 && i + 1 < argc) {
            target = argv[++i];
        } else if (strcmp(argv[i], "/E") == 0 && i + 1 < argc) {
            entry = argv[++i];
        } else if (strcmp(argv[i], "/Fh") == 0 && i + 1 < argc) {
            out_header = argv[++i];
        } else if (strcmp(argv[i], "/Vn") == 0 && i + 1 < argc) {
            var_name = argv[++i];
        } else if (strcmp(argv[i], "/O3") == 0) {
            // optimization level 3
        } else if (argv[i][0] != '/') {
            shader_path = argv[i];
        }
    }

    if (!target || !entry || !out_header || !shader_path) {
        fprintf(stderr, "Usage: fxc /T <target> /E <entry> /Fh <out> /Vn <var> [/O3] <input.hlsl>\n");
        return 1;
    }

    HMODULE d3d = LoadLibraryA("d3dcompiler_47.dll");
    if (!d3d) {
        fprintf(stderr, "Failed to load d3dcompiler_47.dll\n");
        return 1;
    }

    PFN_D3DCompileFromFile pD3DCompileFromFile =
        (PFN_D3DCompileFromFile)GetProcAddress(d3d, "D3DCompileFromFile");
    if (!pD3DCompileFromFile) {
        fprintf(stderr, "Failed to find D3DCompileFromFile\n");
        return 1;
    }

    wchar_t wpath[4096];
    MultiByteToWideChar(CP_UTF8, 0, shader_path, -1, wpath, 4096);

    ID3DBlob *code = NULL;
    ID3DBlob *errors = NULL;
    HRESULT hr = pD3DCompileFromFile(
        wpath,
        NULL,
        D3D_COMPILE_STANDARD_FILE_INCLUDE,
        entry,
        target,
        D3DCOMPILE_OPTIMIZATION_LEVEL3,
        0,
        &code,
        &errors
    );

    if (FAILED(hr) || !code) {
        if (errors) {
            fprintf(stderr, "%.*s\n",
                (int)errors->lpVtbl->GetBufferSize(errors),
                (const char *)errors->lpVtbl->GetBufferPointer(errors));
            errors->lpVtbl->Release(errors);
        } else {
            fprintf(stderr, "D3DCompileFromFile failed with HRESULT 0x%08lx\n", (unsigned long)hr);
        }
        return 1;
    }

    FILE *fp = fopen(out_header, "wb");
    if (!fp) {
        fprintf(stderr, "Failed to open output file: %s\n", out_header);
        return 1;
    }

    unsigned char *bytes = (unsigned char *)code->lpVtbl->GetBufferPointer(code);
    SIZE_T size = code->lpVtbl->GetBufferSize(code);

    fprintf(fp, "const BYTE %s[] =\n{\n", var_name);
    for (SIZE_T i = 0; i < size; i++) {
        fprintf(fp, " %3u%s", (unsigned int)bytes[i], (i + 1 < size) ? "," : "");
        if ((i + 1) % 6 == 0 || i + 1 == size) {
            fprintf(fp, "\n");
        }
    }
    fprintf(fp, "};\n");
    fclose(fp);

    code->lpVtbl->Release(code);
    if (errors) errors->lpVtbl->Release(errors);
    return 0;
}
