'use client'

const examples = [
  {
    title: '登录账号',
    lines: [
      { prompt: true, text: 'xhs login' },
      { prompt: false, text: '打开浏览器，等待登录...' },
      { prompt: false, text: '认证成功', highlight: true },
    ]
  },
  {
    title: '获取账户数据',
    lines: [
      { prompt: true, text: 'xhs data account' },
      { prompt: false, text: '粉丝: 10.2K' },
      { prompt: false, text: '获赞: 245.6K' },
      { prompt: false, text: '笔记: 58篇' },
    ]
  },
  {
    title: '查看已发布笔记',
    lines: [
      { prompt: true, text: 'xhs data posts' },
      { prompt: false, text: '加载中...' },
      { prompt: false, text: '共找到 58 篇笔记', highlight: true },
    ]
  },
  {
    title: '发布新笔记',
    lines: [
      { prompt: true, text: 'xhs post --title "标题" --content "内容" --image ./cover.jpg' },
      { prompt: false, text: '上传中...' },
      { prompt: false, text: '发布成功', highlight: true },
    ]
  }
]

export default function Demo() {
  return (
    <section id="examples" className="py-24 px-6 border-t border-slate-800">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-2">使用示例</h2>
        <p className="text-slate-400 mb-12">简单直观的命令，强大的自动化能力。</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {examples.map((ex, i) => (
            <div key={i} className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-slate-700"></span>
                  <span className="w-3 h-3 rounded-full bg-slate-700"></span>
                  <span className="w-3 h-3 rounded-full bg-slate-700"></span>
                </div>
                <span className="text-slate-500 text-xs ml-2">{ex.title}</span>
              </div>
              <div className="p-4 font-mono text-sm space-y-1.5">
                {ex.lines.map((line, j) => (
                  <div key={j} className="flex gap-2">
                    {line.prompt
                      ? <span className="text-rose-500 shrink-0">$</span>
                      : <span className="w-3 shrink-0"></span>
                    }
                    <span className={
                      line.prompt
                        ? 'text-white'
                        : (line as { highlight?: boolean }).highlight
                          ? 'text-rose-400'
                          : 'text-slate-500'
                    }>
                      {line.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}