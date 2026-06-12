export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function NodeLabPage() {
  return (
    <main style={{ minHeight: "100vh", padding: 32, background: "#080d12", color: "#e8f2ff" }}>
      <section style={{ maxWidth: 720, border: "1px solid rgba(155, 190, 230, 0.25)", borderRadius: 8, padding: 24 }}>
        <p style={{ color: "#9fb4cc", fontWeight: 700, margin: 0 }}>Node/Sector 实验台已退役</p>
        <h1 style={{ margin: "8px 0 12px" }}>请使用 Hex Web 验收台</h1>
        <p style={{ color: "#b9c8d8", lineHeight: 1.7 }}>
          旧 Node Lab 不再作为 Phase 2.0-pre 主线入口。历史 Phase18 replay 仍保留，新的地图、回合、LLM 调用和 combat 审计请进入 HexGrid 验收台。
        </p>
        <a href="/hex-lab/match" style={{ color: "#dff6ea", fontWeight: 800 }}>
          打开 /hex-lab/match
        </a>
      </section>
    </main>
  );
}
