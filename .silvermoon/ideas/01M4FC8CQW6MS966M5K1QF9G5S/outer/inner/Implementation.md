# Implementation

## Steps

### I-S01: 理想世界批准后制定实施步骤

当前处于 preparing。获得针对精确 `idealRevision` 的明确批准后，依据
`Idea.md` 与 `LegacyCapstoneAudit.md` 把契约审计、source-of-truth 选择、
兼容性判断、实现和验证拆成稳定步骤；批准前不授权修改公开 contract、OpenAPI、
client 或 runtime。

## Acceptance criteria

### I-AC01: 实施契约与已批准理想世界一致

实施契约必须引用已批准的精确理想世界 revision，覆盖四类契约表示缺口、
兼容性与 SemVer 判断、自动 drift 防护及 package boundary，并为每项结果指定
可执行证明。
