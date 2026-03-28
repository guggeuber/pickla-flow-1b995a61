import { motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { QrCode } from "lucide-react";

const FONT_HEADING = "'Space Grotesk', sans-serif";

interface QrCodeCardProps {
  userId: string;
  displayName: string;
}

const QrCodeCard = ({ userId, displayName }: QrCodeCardProps) => {
  // QR contains a JSON payload with type + user id for future extensibility
  const qrPayload = JSON.stringify({ type: "pickla_user", uid: userId });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl p-5 flex flex-col items-center gap-3"
      style={{
        background: "rgba(255,255,255,0.06)",
        border: "1.5px solid rgba(255,255,255,0.08)",
      }}
    >
      <div className="flex items-center gap-2 w-full">
        <QrCode className="w-4 h-4" style={{ color: "#E86C24" }} />
        <span className="text-sm font-semibold text-white" style={{ fontFamily: FONT_HEADING }}>
          Min incheckning
        </span>
      </div>

      <div className="bg-white rounded-2xl p-4">
        <QRCodeSVG
          value={qrPayload}
          size={160}
          level="M"
          bgColor="#ffffff"
          fgColor="#1a1e2e"
        />
      </div>

      <p className="text-[11px] text-white/40 text-center">
        Visa denna QR-kod i receptionen för snabb incheckning
      </p>
    </motion.div>
  );
};

export default QrCodeCard;
