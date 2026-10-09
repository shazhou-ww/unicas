# Deployment

## Steps

### D-S01: Implementation 验收后制定部署步骤

当前处于 preparing。只有精确 Implementation revision 获得明确验收后，才根据
实际 public surface 变化制定文档发布、生产兼容性验证和必要的受保护 promotion
步骤；本占位契约不授权外部写入。

## Acceptance criteria

### D-AC01: 部署契约与已验收 Implementation 一致

部署契约必须引用已验收的精确 Implementation revision，证明公开 contract、
文档与 production 行为保持兼容，并保持 npm publish、production promotion 和
其他外部写入需要各自显式授权。
