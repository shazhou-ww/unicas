# 多供应商管理员身份生产验收操作手册

本文档用于完成本任务的生产人工验收。生产地址、供应商回调和安全要求以
[生产 OAuth 与邮件配置](./ProductionOAuthProvisioning.md) 为准。

不要把密码、OAuth 客户端密钥、访问令牌、刷新令牌、邮件验证码或邀请链接
写入本文档、Git、Issue、聊天、截图文件名或命令参数。需要输入秘密时，只在
供应商页面、Cloudflare 控制台或终端的交互式提示中输入。

## 1. 准备测试身份和浏览器环境

至少准备以下身份。不要使用唯一的生产管理员作为被封禁账号。

| 代号 | 用途 | 要求 |
| --- | --- | --- |
| 管理员 A | 创建邀请、查看账号、封禁和恢复测试账号 | 当前可登录，拥有 `platform.admin`；全程保持可用 |
| 测试账号 B | 验证 Microsoft 邀请、三供应商登录和身份关联 | 一个未绑定 UniCAS 的 Microsoft 个人账号、Google 账号和 GitHub 账号；GitHub 邮箱必须已验证 |
| 冲突账号 C | 验证相同邮箱不会自动合并 | 一个未绑定 UniCAS 的供应商身份；其供应商已验证邮箱与 B 的邀请邮箱相同 |
| 测试邮箱 E | 接收 Microsoft 邮件验证码 | 能正常收取外部邮件；不要预先加入 Cloudflare 允许收件人列表 |

建议为 A、B、C 分别使用独立浏览器配置文件或无痕窗口，避免供应商自动选择
错误账号。开始前记录窗口与身份的对应关系。

- [x] 管理员 A、测试账号 B、冲突账号 C 和测试邮箱 E 已准备完成
- [x] A、B、C 使用相互隔离的浏览器会话，且管理员 A 在整个验收期间保持可用
> 备注

## 2. 检查生产服务和邮件发送能力

1. 在浏览器打开 `https://api.unicas.work/health`。
2. 确认返回成功状态，不含维护模式或内部错误。
3. 打开 `https://console.unicas.work/`，确认能进入登录页或跳转到 `/admin/`。
4. 在 Cloudflare 控制台打开 **Compute** > **Email Service** >
   **Email Sending**。
5. 确认 `unicas.work` 状态为 Enabled。Cloudflare 按已 onboarding 的发件域名
   授权，不会另外列出或验证 `no-reply@unicas.work` 这样的单个发件地址。
6. 打开 `unicas` Worker 的 Settings > Bindings，确认 `EMAIL` 是
   `Send Email / unrestricted`，并确认 `ADMIN_EMAIL_FROM` 是
   `no-reply@unicas.work`。`unrestricted` 表示 binding 没有额外的
   `allowed_sender_addresses` 限制；发件地址仍必须属于已启用的域名。

也可从仓库根目录用 `cfg` 中已有的 Cloudflare 凭据执行只读检查。以下命令只把
值注入当前 PowerShell 进程，不会打印令牌：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = (cfg get CLOUDFLARE_ACCOUNT_ID).Trim()
$env:CLOUDFLARE_API_TOKEN = (cfg get CLOUDFLARE_API_TOKEN).Trim()
pnpm --filter @unicas/service-cloudflare exec wrangler email sending list
```

只有输出中列出 `unicas.work` 且状态为 active，相关勾选项才算通过。输出
`No sending subdomains found in this account.` 表示尚未开通，而不是 Worker binding
配置错误。如果命令返回 `Authentication error`，表示当前 API token 缺少 Email
Sending 权限，不能据此判断域名状态；此时以 Cloudflare Dashboard 显示的
Enabled 状态为准。

若 Email Sending、域名或 binding 不可用，停止 Microsoft 邀请验收并记录阻塞。
不要改用 Resend；当前 Worker 没有 Resend 适配器。

- [x] API 健康检查和 Console 均可访问
- [x] Cloudflare Email Sending 中 `unicas.work` 显示 Enabled
- [x] 生产 Worker 显示 `EMAIL` 为 Send Email / unrestricted，且
   `ADMIN_EMAIL_FROM` 为 `no-reply@unicas.work`

## 3. 用管理员 A 创建测试账号 B 的邀请

推荐通过 Console 操作：

1. 用管理员 A 登录 `https://console.unicas.work/`。
2. 打开 Platform Administration 的 People 页面。
3. 切换到 Pending invitations。
4. 创建发送到测试邮箱 E 的平台邀请。
5. 至少授予 `apps.create`；不要为了本次验收给 B 授予 `platform.admin`。
6. 只在当前受控会话中打开或转交新生成的邀请 URL，不要把 URL 写入本文档或聊天。

也可使用 CLI：

```powershell
pnpm --filter @unicas/admin-cli build
pnpm --filter @unicas/admin-cli unicas login
pnpm --filter @unicas/admin-cli unicas platform-invitations create <测试邮箱E> --authority apps.create --idempotency-key multi-provider-acceptance-b
```

通过标准：创建结果含 `invitationId`、一次性 `acceptUrl`、`expiresAt` 和
`etag`；邀请列表不再次暴露 `acceptUrl`。

- [ ] 管理员 A 成功创建测试账号 B 的最小权限邀请
- [ ] 邀请列表不再次暴露一次性 `acceptUrl`

## 4. 用 Microsoft 个人账号接受邀请

1. 在测试账号 B 的独立浏览器窗口打开上一步的 `acceptUrl`。
2. 选择 Microsoft，并使用 B 的 Microsoft **个人账号**登录。
3. 确认登录后仍要求验证邀请邮箱，而不是直接凭 Microsoft 的 `email` 或
   `preferred_username` claim 通过。
4. 在测试邮箱 E 中查收来自 `no-reply@unicas.work` 的六位验证码。
5. 检查邮件的 SPF、DKIM 和 DMARC 结果；记录是否进入垃圾邮件，但不要记录验证码。
6. 先输入一个错误验证码，确认页面只显示通用失败信息，不泄露邀请或账号是否存在。
7. 输入正确验证码，确认邀请接受成功并进入 Console。
8. 再次提交同一验证码或刷新旧提交，确认不能重复使用。
9. 打开右上角用户菜单 > **Account**，记录 B 的 `accountId`，后文记为
   `B_ACCOUNT_ID`。
10. 确认 Login methods 中显示 Microsoft，Primary verified contact 为 E，
    Verification source 表示 UniCAS 邮件验证，而不是 Microsoft claim。
11. 检查浏览器最终地址，不应出现 OAuth code、provider token、邮件验证码或邀请 token。

通过标准：邮件能送达非预验证邮箱；错误码失败；正确码只成功一次；B 获得稳定
Account 和邀请授予的权限。

- [ ] 邮件实际送达未预验证的外部邮箱，SPF、DKIM 和 DMARC 结果正常
- [ ] Microsoft 登录后仍要求独立邮件验证码
- [ ] 错误验证码失败，且响应不泄露账号或邀请状态
- [ ] 正确验证码成功一次，重放失败
- [ ] B 获得稳定 Account 和邀请授予的权限

## 5. 把 Google 和 GitHub 关联到测试账号 B

以下操作必须从 B 已登录的 **Account** 页面开始，不能直接退出后用新供应商
登录，否则可能创建另一个 Account。

### 5.1 关联 Google

1. 在 Account > Login methods 选择 **Link login method** > **Google**。
2. 按页面要求重新验证当前 Microsoft 身份。
3. 使用为 B 准备且尚未绑定 UniCAS 的 Google 账号完成登录。
4. 返回 Account 页面，确认 Microsoft 和 Google 同时显示。
5. 确认页面上的 `accountId` 仍等于 `B_ACCOUNT_ID`。

### 5.2 关联 GitHub

1. 选择 **Link login method** > **GitHub**。
2. 按页面要求重新验证当前身份。
3. 使用 B 的 GitHub 账号授权。
4. 在 GitHub 同意页面确认请求仅涉及基本资料和邮箱，不包含仓库或组织写权限。
5. 返回 Account 页面，确认 Microsoft、Google 和 GitHub 同时显示。
6. 再次确认 `accountId` 仍等于 `B_ACCOUNT_ID`。

通过标准：三种登录方法属于同一个 Account；App memberships、平台权限和
Primary verified contact 没有因为关联而转移或重复。

如果页面提示目标身份已属于另一个 Account，停止该身份的关联测试。该拒绝是
正确行为；换用一个未绑定身份完成成功关联，不要尝试删除或合并既有 Account。

- [ ] Google 成功关联到 B，`accountId` 保持不变
- [ ] GitHub 成功关联到 B，且 consent 不含仓库或组织写权限
- [ ] 三种身份的 memberships、平台权限和主要验证邮箱保持一致

## 6. 分别验证三种 Console 登录

对 Microsoft、Google、GitHub 各执行一次：

1. 从 Console 正常退出。
2. 关闭该测试窗口，重新打开新的无痕窗口。
3. 打开 `https://console.unicas.work/`，选择本轮供应商。
4. 使用 B 对应的供应商身份登录。
5. 确认回到 Console，而不是错误页或其他域名。
6. 打开 Account 页面，确认 `accountId` 等于 `B_ACCOUNT_ID`。
7. 确认 App memberships 和权限在三次登录中一致。
8. 检查最终 URL 不包含 code、token、challenge 或邀请参数。

精确回调应分别使用：

```text
https://console.unicas.work/admin/auth/callback/google
https://console.unicas.work/admin/auth/callback/microsoft
https://console.unicas.work/admin/auth/callback/github
```

看到 `redirect_uri_mismatch` 时停止该供应商验收，并检查供应商注册中的 URL 是否
逐字符一致，包括协议、域名、路径、大小写和末尾没有 `/`。

- [ ] Google Console 登录通过，`accountId`、memberships 和权限一致
- [ ] Microsoft Console 登录通过，`accountId`、memberships 和权限一致
- [ ] GitHub Console 登录通过，`accountId`、memberships 和权限一致
- [ ] 三种登录的最终 URL 均未残留 code、token、challenge 或邀请参数

## 7. 分别验证三种 CLI 登录

先构建 CLI：

```powershell
pnpm --filter @unicas/admin-cli build
```

对 Microsoft、Google、GitHub 各执行一次：

1. 运行：

   ```powershell
   pnpm --filter @unicas/admin-cli unicas logout
   pnpm --filter @unicas/admin-cli unicas login
   ```

2. 在自动打开的浏览器中选择本轮供应商并使用 B 登录。
3. 浏览器显示授权完成后回到终端。
4. 运行：

   ```powershell
   pnpm --filter @unicas/admin-cli unicas account
   pnpm --filter @unicas/admin-cli unicas apps list
   ```

5. 确认 `account` 输出的 `accountId` 等于 `B_ACCOUNT_ID`，三种供应商下 App
   列表和权限一致。
6. 每轮结束运行 `unicas logout`，确保下一轮重新认证。

不要提交或分享 `~/.unicas/session.json`。它是当前操作者的本地会话凭据。

- [ ] Google CLI 登录及 Account/App 读取通过
- [ ] Microsoft CLI 登录及 Account/App 读取通过
- [ ] GitHub CLI 登录及 Account/App 读取通过

## 8. 分别验证三种远程 MCP 登录

在 VS Code 的 MCP 配置中加入远程服务；配置中不需要 API key 或 OAuth client
secret：

```json
{
  "servers": {
    "unicas-control-plane": {
      "type": "http",
      "url": "https://api.unicas.work/mcp"
    }
  }
}
```

对 Microsoft、Google、GitHub 各执行一次：

1. 在 MCP 客户端中断开或撤销上一轮 UniCAS 授权，然后重新连接
   `unicas-control-plane`。
2. 在打开的浏览器中选择本轮供应商并使用 B 登录。
3. 检查 UniCAS consent 页面，只批准本次测试需要的 scope。
4. 完成授权后调用 `get_current_account`。
5. 调用 `list_apps`，确认结果与 Console/CLI 一致。
6. 确认 `get_current_account` 的 `accountId` 等于 `B_ACCOUNT_ID`。
7. 在客户端撤销本轮授权，再开始下一供应商，避免复用旧 grant。

精确 MCP 回调应分别使用：

```text
https://api.unicas.work/oauth/callback/google
https://api.unicas.work/oauth/callback/microsoft
https://api.unicas.work/oauth/callback/github
```

通过标准：三个供应商都能签发 UniCAS grant；工具调用使用同一 Account；撤销后
旧授权不能继续调用工具。不要用手工注入 bearer token 代替该测试。

- [ ] Google MCP 授权、Account/App 读取和撤销通过
- [ ] Microsoft MCP 授权、Account/App 读取和撤销通过
- [ ] GitHub MCP 授权、Account/App 读取和撤销通过

## 9. 验证相同邮箱不会自动合并

此项使用冲突账号 C，且不能破坏 B 已关联的三种身份。

1. 管理员 A 再创建一个发送到邮箱 E 的邀请，只授予最小测试权限。
2. 在 C 的独立浏览器配置文件中打开邀请 URL。
3. 使用 C 的供应商身份完成认证；该身份报告的已验证邮箱应与 E 相同。
4. 按要求完成邀请验证并打开 Account 页面。
5. 记录 C 的 `accountId`，确认它与 `B_ACCOUNT_ID` 不同。
6. 确认 C 没有继承 B 的 memberships 或平台权限。
7. 从 B 的 Account 页面尝试关联已经属于 C 的身份。
8. 确认系统拒绝关联，并且没有合并 Account、移动权限或改变两个 `accountId`。

通过标准：相同邮箱只可作为当前邀请的验证证据，不会成为 Account 主键或触发
自动合并。

- [ ] B 与 C 使用相同验证邮箱后仍具有不同 `accountId` 和独立权限
- [ ] 已属于 C 的身份关联到 B 时被拒绝，且没有移动或合并权限

## 10. 验证解除关联保护

1. 以 B 登录并打开 Account > Login methods。
2. 对一个非当前身份选择 Unlink。
3. 按要求使用保留的登录方法重新认证。
4. 确认解除后 `accountId`、memberships 和权限不变，旧会话需要重新认证。
5. 将刚解除的身份重新关联，以恢复三供应商验收状态。
6. 确认界面不允许删除最后一个登录方法。

不要为了测试最后身份保护而删除 B 的所有身份；按钮禁用或服务端拒绝即为通过。

- [ ] 解除关联要求重新认证，且不改变 B 的 Account、memberships 或权限
- [ ] 系统不允许解除最后一个可用登录身份

## 11. 验证封禁会使所有登录和 grant 失效

此项必须由管理员 A 操作测试账号 B。不要封禁 A 自己。

1. 在 B 的一个浏览器窗口保持 Console 登录。
2. 在另一个客户端保持 B 的远程 MCP grant 可用。
3. 用管理员 A 打开 Platform Administration > People，找到
   `B_ACCOUNT_ID` 并打开 Account Details。
4. 选择 **Block Account** 并确认。
5. 回到 B 的 Console，刷新页面或执行一个受保护操作，确认会话被拒绝。
6. 用 B 的 Microsoft、Google、GitHub 分别尝试新登录，确认全部被拒绝。
7. 用封禁前的 MCP grant 调用 `get_current_account`，确认被拒绝。
8. 用管理员 A 对 B 选择 **Restore Account**。
9. 让 B 重新登录；确认旧会话/grant 不会自行恢复，但新登录成功且
   `accountId`、memberships 和权限仍保持不变。

通过标准：封禁覆盖所有关联身份及既有凭据；恢复不会复活旧凭据。

- [ ] 封禁 B 后，三种供应商的新登录全部被拒绝
- [ ] 封禁 B 后，已有 Console 会话和 MCP grant 均失效
- [ ] 恢复 B 后旧凭据不会复活
- [ ] 恢复 B 后新登录成功，原 `accountId`、memberships 和权限保持不变

CLI 等价命令如下，两个位置必须填写同一个 B Account ID：

```powershell
pnpm --filter @unicas/admin-cli unicas platform-access block <B_ACCOUNT_ID> --confirm-account-id <B_ACCOUNT_ID>
pnpm --filter @unicas/admin-cli unicas platform-access restore <B_ACCOUNT_ID> --confirm-account-id <B_ACCOUNT_ID>
```

## 12. 检查隐私、日志和审计证据

1. 在 Cloudflare Worker 日志中按测试时间窗口检查登录、callback、link、unlink、
   invitation 和 block/restore 请求。
2. 在 GitHub Actions 的相关生产 workflow 日志中检查部署和 smoke 输出。
3. 在 Console 的 Platform Audit 与 App Audit 中检查操作归属。
4. 确认审计记录包含稳定 Account 和必要的供应商身份归属，但不包含 provider
   access/refresh token、client secret、邮件验证码、邀请 token 或私有邮箱列表。
5. 检查浏览器历史和最终 URL，不应残留上述秘密。
6. 在批准的运维系统中记录密钥 owner 和轮换/到期日期；不要记录到仓库。

发现任何秘密泄露时，立即停止验收并在对应供应商或秘密管理系统中吊销、轮换；
不要先把秘密内容贴到聊天里排查。

- [ ] URL、Worker/Actions 日志和审计记录均未泄露秘密
- [ ] 审计记录正确归属到稳定 Account 和实际认证身份
- [ ] 密钥 owner 和轮换/到期日期已记录在批准的运维系统中

## 13. 汇总结果并提交交付批准

完成后只汇报脱敏结果，可使用以下格式：

```text
Google Console / CLI / MCP：通过或失败原因
Microsoft Console / CLI / MCP：通过或失败原因
Microsoft 外部邮箱挑战、错误码、单次使用：通过或失败原因
GitHub Console / CLI / MCP 与授权范围：通过或失败原因
三身份同一 accountId：通过或失败原因（不要贴 provider subject）
相同邮箱不自动合并：通过或失败原因
解除关联与最后身份保护：通过或失败原因
封禁、旧会话/grant 失效、恢复后新登录：通过或失败原因
URL、Worker/Actions 日志和审计隐私检查：通过或失败原因
```

全部勾选后，告诉任务执行代理“验收完成”。代理会核对当时最新的主分支提交并向
你发起明确的 Delivery acceptance 请求；你只需对代理给出的提交选择批准或拒绝，
不需要自行查找或填写提交哈希。

如果任一项失败，不要批准 Delivery acceptance。记录失败步骤、时间、供应商、页面
显示的非敏感错误码和预期/实际结果即可；不要自行修改 `Progress.md` 或
`tasks/status.yaml`。