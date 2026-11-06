use std::path::PathBuf;
use std::process::Command;
use std::{env, fs};

/// Builds the Explorer thumbnail provider (`thumbnail/`) and stages the DLL in `resources/`, from
/// where `tauri.conf.json` bundles it into the installer.
///
/// It is built with its own target directory: cargo is already holding the lock on this package's
/// one while the build script runs, so building into the same place would deadlock.
fn build_thumbnail_provider() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let crate_dir = manifest_dir.join("thumbnail");

    println!("cargo:rerun-if-changed=thumbnail/src");
    println!("cargo:rerun-if-changed=thumbnail/Cargo.toml");
    println!("cargo:rerun-if-changed=thumbnail/Cargo.lock");

    let target_dir = manifest_dir.join("target").join("thumbnail-build");
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let status = Command::new(cargo)
        .args(["build", "--release", "--manifest-path"])
        .arg(crate_dir.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target_dir)
        // The outer build's flags and target selection are not meant for this separate crate.
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .status()
        .expect("failed to run cargo to build the thumbnail provider");
    assert!(status.success(), "building the thumbnail provider failed");

    let built = target_dir.join("release").join("pdf_reader_thumbnail.dll");
    let staged_dir = manifest_dir.join("resources");
    fs::create_dir_all(&staged_dir).expect("cannot create resources/");
    fs::copy(&built, staged_dir.join("pdf_reader_thumbnail.dll"))
        .unwrap_or_else(|e| panic!("cannot stage {}: {e}", built.display()));
}

fn main() {
    build_thumbnail_provider();
    tauri_build::build()
}
