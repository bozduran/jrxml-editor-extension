Build branches visually:

```java
IF(EQUALS($F{status}, "PAID"), "Paid", "Unknown")
```

Run **JRXML: Open If / Else Builder** (or `Ctrl+Alt+B`) with the cursor inside the
expression. The builder reads the report's fields, parameters and variables
automatically, and **Apply to File** writes the result back into the tag.
