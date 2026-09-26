mod files;
mod host;
pub mod mcp;
mod png_export;
mod projects;
mod recovery;
mod validation;
pub fn run() {
    host::run();
}

mod automation;
mod private;

#[cfg(all(feature = "automation", target_os = "macos"))]
mod test_processes;

#[cfg(all(test, target_os = "linux"))]
mod glib_regression {
    #[test]
    fn variant_str_iter() {
        use glib::variant::ToVariant;

        let values = ["first", "", "λ", "last"];
        let variant = values.to_variant();
        let iter = || variant.array_iter_str().unwrap();
        assert_eq!(iter().collect::<Vec<_>>(), values);
        assert_eq!(iter().rev().collect::<Vec<_>>(), ["last", "λ", "", "first"]);
        assert_eq!(iter().nth(2), Some("λ"));
        assert_eq!(iter().nth_back(2), Some(""));
        assert_eq!(iter().last(), Some("last"));
        assert_eq!(iter().nth(values.len()), None);
        let empty = Vec::<String>::new().to_variant();
        assert_eq!(empty.array_iter_str().unwrap().next(), None);
    }
}
