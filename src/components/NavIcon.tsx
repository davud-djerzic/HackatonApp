type NavIconProps = {
  src: string;
  label: string;
  active?: boolean;
  variant?: "sidebar" | "bottom";
};

export default function NavIcon({ src, active, variant = "sidebar" }: NavIconProps) {
  const fallback = src.replace(/\.png$/, ".svg");
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={`nav-img nav-img-${variant} ${active ? "is-active" : ""}`}
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.fallback) {
          img.dataset.fallback = "1";
          img.src = fallback;
        }
      }}
    />
  );
}
