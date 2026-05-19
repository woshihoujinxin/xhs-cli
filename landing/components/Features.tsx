'use client'

const features = [
  {
    title: '多账号管理',
    description: '支持同时管理多个小红书账号，认证信息本地加密存储，代运营团队必备。'
  },
  {
    title: '运营数据分析',
    description: '实时获取账户数据、粉丝增长、笔记互动热度，用数据指导运营决策。'
  },
  {
    title: '内容批量管理',
    description: '批量查看和管理已发布笔记，快速盘点账号内容资产，提升运营效率。'
  },
  {
    title: '自动发布',
    description: '通过命令行自动发布图文笔记，支持标题、正文、多图，节省大量重复操作时间。'
  },
  {
    title: 'AI Agent 集成',
    description: '与 AI Agent 无缝集成，支持 MCP 协议，构建全自动化小红书运营工作流。'
  },
  {
    title: '二次开发友好',
    description: '完善的 Node.js API，可嵌入自有运营系统，灵活定制代运营自动化方案。'
  }
]

export default function Features() {
  return (
    <section id="features" className="py-24 px-6 border-t border-slate-800">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-2">核心功能</h2>
        <p className="text-slate-400 mb-12">为小红书运营和代运营团队精心打造。</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-800 border border-slate-800 rounded-lg overflow-hidden">
          {features.map((f, i) => (
            <div key={i} className="bg-slate-950 p-6 hover:bg-slate-900 transition-colors">
              <h3 className="text-white font-semibold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}