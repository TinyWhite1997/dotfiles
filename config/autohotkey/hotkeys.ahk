#Requires AutoHotkey v2.0
#SingleInstance Force

; WeChat voice input: trigger once on release, using right Alt specifically.
F8 Up::{
    SetKeyDelay 30, 50
    SendEvent "{RAlt down}{Space}{RAlt up}"
}

*LShift::{
    SetKeyDelay -1
    Send "{Blind}{LShift DownR}{vkFF Up}"
    KeyWait "LShift"
}

~*LShift Up::{
    SetKeyDelay -1
    Send "{Blind}{LShift Up}"
}
