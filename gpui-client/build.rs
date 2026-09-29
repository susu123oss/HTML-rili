use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let manifest_path = out_dir.join("app.manifest.xml");
        let rc_path = out_dir.join("app.rc");
        let obj_path = out_dir.join("app_manifest.o");

        let manifest_xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
    <asmv3:application>
        <asmv3:windowsSettings>
            <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
            <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
        </asmv3:windowsSettings>
    </asmv3:application>
    <dependency>
        <dependentAssembly>
            <assemblyIdentity
                type="win32"
                name="Microsoft.Windows.Common-Controls"
                version="6.0.0.0"
                processorArchitecture="*"
                publicKeyToken="6595b64144ccf1df"
                language="*"
            />
        </dependentAssembly>
    </dependency>
</assembly>
"#;
        fs::write(&manifest_path, manifest_xml).expect("Failed to write app.manifest.xml");

        let escaped_manifest = manifest_path
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let rc_content = format!("#define RT_MANIFEST 24\n1 RT_MANIFEST \"{}\"\n", escaped_manifest);
        fs::write(&rc_path, rc_content).expect("Failed to write app.rc");

        let windres = {
            let scoop_windres = r"C:\Users\Administrator\scoop\apps\mingw\current\bin\windres.exe";
            if PathBuf::from(scoop_windres).exists() {
                scoop_windres.to_string()
            } else {
                "windres".to_string()
            }
        };

        let status = Command::new(&windres)
            .args([
                "-i",
                rc_path.to_str().unwrap(),
                "-o",
                obj_path.to_str().unwrap(),
            ])
            .status()
            .expect("Failed to execute windres.exe");

        assert!(status.success(), "windres failed to compile Windows manifest resource");

        println!("cargo:rustc-link-arg-bins={}", obj_path.display());
    }
}
