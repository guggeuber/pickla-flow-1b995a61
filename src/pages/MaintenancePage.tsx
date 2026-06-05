const buttons = [
  { text: "WhatsApp Community", url: "https://chat.whatsapp.com/HL1XcYaNFSuE56q7MqCpdw" },
  { text: "E-post", url: "mailto:solna@picklaparks.com" },
  { text: "Instagram @picklaparks", url: "https://instagram.com/picklaparks" },
  { text: "Facebook @picklaparks", url: "https://facebook.com/picklaparks" },
];

const MaintenancePage = () => {
  return (
    <main className="min-h-screen bg-[#FFFAF8] text-neutral-900 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md mx-auto text-center space-y-6">
        <img
          src="/pickla-icon.svg"
          alt="Pickla"
          className="w-16 h-16 mx-auto"
          onError={(e) => ((e.currentTarget.style.display = "none"))}
        />
        <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">
          Välkommen till Pickla!
        </h1>
        <div className="space-y-3 text-base text-neutral-600">
          <p>Vi genomför just nu en systemuppdatering av bokningssystemet.</p>
          <p className="text-neutral-900 font-medium">🏓 Hallen är öppen som vanligt.</p>
          <p>
            För bokningar, uppdateringar och frågor kan du kontakta oss via WhatsApp,
            e-post, Instagram eller Facebook.
          </p>
        </div>

        <div className="flex flex-col gap-2.5 pt-2">
          {buttons.map((b) => (
            <a
              key={b.text}
              href={b.url}
              target={b.url.startsWith("mailto:") ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center rounded-xl bg-black text-white font-medium px-4 py-3 text-base hover:bg-neutral-800 transition-colors"
            >
              {b.text}
            </a>
          ))}
        </div>

        <div className="pt-4 text-sm text-neutral-500 space-y-1">
          <p>Tack för ditt tålamod.</p>
        </div>
      </div>
    </main>
  );
};

export default MaintenancePage;
