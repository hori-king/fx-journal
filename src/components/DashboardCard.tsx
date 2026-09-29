interface DashboardCardProps {
  title: string;
  value: string;
  variant?: "default" | "win" | "loss" | "draw";
}

function DashboardCard({ title, value, variant }: DashboardCardProps) {
  return (
    <div className={`dashboard-card ${variant}`}>
      <p className="dashboard-card-title">{title}</p>
      <h2 className="dashboard-card-value">{value}</h2>
    </div>
  );
}

export default DashboardCard;