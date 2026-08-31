export default function DashboardBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {/* MOVING GRID */}
      <div className="dashboard-grid absolute inset-0" />

      {/* LEFT GLOW */}
      <div className="dashboard-glow dashboard-glow-left absolute" />

      {/* RIGHT GLOW */}
      <div className="dashboard-glow dashboard-glow-right absolute" />

      {/* SCANNING LINE */}
      <div className="dashboard-scanline absolute left-0 top-0 w-full" />

      {/* VIGNETTE */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(10,10,12,0.15)_45%,rgba(10,10,12,0.75)_100%)]" />
    </div>
  );
}