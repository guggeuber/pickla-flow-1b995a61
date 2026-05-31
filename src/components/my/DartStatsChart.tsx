import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

type DartTrendPoint = {
  label: string;
  average: number;
  high_score: number;
};

export default function DartStatsChart({ data, blue, green, border }: { data: DartTrendPoint[]; blue: string; green: string; border: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="label" hide />
        <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: `1px solid ${border}`, fontSize: 12 }}
          formatter={(value, name) => [Number(value).toFixed(1), name === "average" ? "3-pil" : name]}
        />
        <Line type="monotone" dataKey="average" stroke={blue} strokeWidth={3} dot={false} />
        <Line type="monotone" dataKey="high_score" stroke={green} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
