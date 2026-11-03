Format one expression without touching the rest of the file:

```java
$F{customer}.getName().trim().toUpperCase()
```

Run **JRXML: Format Expression at Cursor**. CDATA wrapping is preserved, and the
change is a single undoable edit. Use **Format Document** when you want the whole
report formatted instead.
