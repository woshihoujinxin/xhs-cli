'use client'

import { useState } from 'react'

const faqs = [
  {
    q: '什么是 xhs-cli？',
    a: 'xhs-cli 是一个开源命令行工具，专为小红书创作者设计。提供账户认证、数据分析、笔记管理和自动发布等功能。'
  },
  {
    q: '如何安装？',
    a: '确保已安装 Node.js 20+，然后运行 npm install -g xhs-cli。安装完成后执行 xhs help 查看所有命令。'
  },
  {
    q: '数据安全吗？',
    a: '代码完全开源可审查。所有数据仅存储在本地 ~/.xhs-cli/.cache/ 目录，不会上传到任何第三方服务器。'
  },
  {
    q: '可以集成到我的 AI Agent 中吗？',
    a: '支持。xhs-cli 提供 Node.js API，可直接在应用中调用，同时支持 MCP 协议与 AI Agent 集成。'
  },
  {
    q: '如何贡献代码或反馈问题？',
    a: '欢迎通过 GitHub Issues 提交 Bug 或功能建议，也欢迎直接提交 Pull Request 参与贡献。'
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section id="faq" className="py-24 px-6 border-t border-slate-800">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-2">常见问题</h2>
        <p className="text-slate-400 mb-12">
          更多问题可在{' '}
          <a
            href="https://github.com/joohw/xhs-cli/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-rose-400 hover:text-rose-300 transition-colors"
          >
            GitHub Issues
          </a>{' '}
          提出。
        </p>

        <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
          {faqs.map((item, i) => (
            <div key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-900 transition-colors"
              >
                <span className="text-white text-sm font-medium">{item.q}</span>
                <span className="text-slate-500 text-xs ml-4 shrink-0">{open === i ? '-' : '+'}</span>
              </button>
              {open === i && (
                <div className="px-6 py-4 bg-slate-900/50 text-slate-400 text-sm leading-relaxed border-t border-slate-800">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}