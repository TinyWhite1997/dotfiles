#Requires AutoHotkey v2.0
#SingleInstance Force

*LShift::{
    SetKeyDelay -1
    Send "{Blind}{LShift DownR}{vkFF Up}"
    KeyWait "LShift"
}

~*LShift Up::{
    SetKeyDelay -1
    Send "{Blind}{LShift Up}"
}
