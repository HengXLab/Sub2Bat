// Sub2Bat is always a GUI application on Windows, including local debug builds.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    sub2bat_lib::run()
}
