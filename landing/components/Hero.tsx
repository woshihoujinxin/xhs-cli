'use client'

export default function Hero() {
  return (
    <section className="pt-40 pb-24 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-800 border border-slate-700 rounded-full mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
          <span className="text-slate-300 text-xs">开源 · v1.0.11 · GPL-3.0</span>
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold text-white leading-tight tracking-tight mb-6">
          小红书运营
          <br />
          <span className="text-rose-500">自动化工具</span>
        </h1>

        <p className="text-slate-400 text-lg leading-relaxed mb-10 max-w-xl">
          xhs-cli 是专为小红书运营和代运营团队打造的开源命令行工具。自动化账户管理、数据分析、内容批量发布，大幅降低重复操作成本。
        </p>

        <div className="flex flex-wrap gap-3 mb-12">
          <a
            href="https://www.npmjs.com/package/xhs-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white font-semibold rounded-md text-sm transition-colors"
          >
            npm install
          </a>
          <a
            href="https://github.com/joohw/xhs-cli#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-md text-sm font-medium transition-colors"
          >
            查看文档
          </a>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 max-w-lg">
          <p className="text-slate-500 text-xs uppercase tracking-widest mb-4">快速开始</p>
          <div className="space-y-2 font-mono text-sm">
            <div>
              <span className="text-slate-600 select-none">$ </span>
              <span className="text-rose-400">npm install -g xhs-cli</span>
            </div>
            <div>
              <span className="text-slate-600 select-none">$ </span>
              <span className="text-rose-400">xhs help</span>
            </div>
          </div>
          <p className="text-slate-600 text-xs mt-4">需要 Node.js 20+</p>
        </div>
      </div>
    </section>
  )
}