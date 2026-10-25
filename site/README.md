# 邮件 Agent 展示网页

公开页面：<https://yangz182.github.io/email-agent/>

本文件夹集中保存网页及其部署材料，与根目录的 Python 邮件助手、回归测试和模型评测分别维护。

| 位置 | 用途 |
| --- | --- |
| `dist/index.html` | 页面结构、项目介绍与已验证的评测结果 |
| `dist/styles.css` | 桌面布局与样式 |
| `dist/app.js` | 8 封预置邮件、审核状态和累计点亮的 Graph |
| `dist/assets/` | 网页引用的合成数据验收截图 |
| `.openai/hosting.json` | Sites 站点标识及静态目录配置 |
| `.artifacts/` | 本地发布包，可重新生成，不提交 Git |
| `.source-history/` | Sites 独立源码仓库的本地 Git 历史，不提交 Git |

## 本地预览

从项目根目录运行：

```powershell
Set-Location D:\projects\agent-from-scratch-MVP
.\.venv\Scripts\python.exe -m http.server 8520 --bind 127.0.0.1 --directory site\dist
```

打开 <http://127.0.0.1:8520>。点击“读取全部邮件”，在“通知 / 待回复”处理邮件；“显示已完成”可回看自动忽略和已结束任务的执行路径。

网页不需要 `.env` 或 Python 业务模块，不连接邮箱、模型和数据库。输入与处理进度保存在当前页面内存，刷新或重新开始后重置。

## 发布维护

推送 `main` 分支中的 `site/dist/` 或 `.github/workflows/pages.yml` 后，GitHub Actions 自动将 `site/dist/` 发布到 GitHub Pages。旧 Sites 配置和 `.source-history/` 仅用于保留历史发布记录。

Python 回归测试保留在根目录 `tests/`；30 封真实模型基线与报告保留在 `evaluation/`，均不属于本网页的静态资源。
