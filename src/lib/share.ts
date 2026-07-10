type ShareOrCopyInput = {
  title?: string;
  text?: string;
  url?: string;
  copyText?: string;
  preferNativeShare?: boolean;
};

export function copyWithFallback(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
  return Promise.resolve();
}

export async function shareOrCopy({
  title,
  text,
  url,
  copyText,
  preferNativeShare = true,
}: ShareOrCopyInput): Promise<"shared" | "copied" | "cancelled"> {
  const fallbackText = copyText || [text, url].filter(Boolean).join("\n") || url || "";
  const shareData = { title, text, url };

  try {
    if (preferNativeShare && navigator.share && (title || text || url)) {
      if (navigator.canShare && !navigator.canShare(shareData)) {
        throw new Error("navigator.canShare returned false");
      }
      await navigator.share(shareData);
      return "shared";
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      return "cancelled";
    }
    console.warn("[share] Native share failed, falling back to copy", {
      name: error?.name,
      message: error?.message,
    });
    // Safari/iOS can throw platform-specific share errors. We always fall back
    // to copying so users never see raw platform errors.
  }

  await copyWithFallback(fallbackText);
  return "copied";
}
