# Deployment

## Steps

### D-S01: 实施被接受后制定外部动作

当前 deployment contract 仅为占位。Implementation 被针对精确修订接受后，
再定义 GitHub metadata/community profile、npm deprecation、GitHub Release
和候选版本发布的顺序、授权、证据与失败恢复；本占位不授权任何 registry 写入。

## Acceptance criteria

### D-AC01: 外部状态与已接受实现可追溯

未来 Deployment acceptance 必须以公开 GitHub/npm 读取结果证明外部状态与
已接受 implementation、精确 primary commit、immutable tag、release manifest
和 provenance 一致，并证明没有未经授权发布或改写已发布版本。
