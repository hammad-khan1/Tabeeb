import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabeebLogoVariant = "primary" | "stacked" | "icon";
export type TabeebLogoSize = "sm" | "md" | "lg" | "xl";

export interface TabeebLogoProps {
  /**
   * The visual logo variant:
   * - `primary`: Horizontal logo with green icon and wordmark (ideal for navbars, topbars, sidebars)
   * - `stacked`: Icon stacked vertically above wordmark (ideal for auth headers, hero sections, modal headers)
   * - `icon`: Standalone green rounded-square app icon with ECG pulse (ideal for collapsed sidebars, favicons, avatars)
   */
  variant?: TabeebLogoVariant;
  /**
   * Preset sizing: `sm`, `md`, `lg`, `xl`
   */
  size?: TabeebLogoSize;
  /**
   * Optional custom width/height override
   */
  width?: number;
  height?: number;
  /**
   * Optional custom className for wrapper
   */
  className?: string;
  /**
   * Optional Next.js Image priority
   */
  priority?: boolean;
  /**
   * Custom alt description
   */
  alt?: string;
  /**
   * If provided, wraps the logo in a Next.js Link
   */
  href?: string;
  /**
   * Force a specific theme variant or 'auto' (switches via Tailwind dark: classes)
   */
  theme?: "auto" | "light" | "dark";
}

const SIZE_MAP = {
  primary: {
    sm: { width: 95, height: 28 },
    md: { width: 122, height: 36 },
    lg: { width: 150, height: 44 },
    xl: { width: 190, height: 56 },
  },
  stacked: {
    sm: { width: 52, height: 48 },
    md: { width: 78, height: 72 },
    lg: { width: 104, height: 96 },
    xl: { width: 130, height: 120 },
  },
  icon: {
    sm: { width: 28, height: 28 },
    md: { width: 36, height: 36 },
    lg: { width: 48, height: 48 },
    xl: { width: 64, height: 64 },
  },
};

export function TabeebLogo({
  variant = "primary",
  size = "md",
  width: customWidth,
  height: customHeight,
  className,
  priority = false,
  alt = "Tabeeb - AI Health Companion",
  href,
  theme = "auto",
}: TabeebLogoProps) {
  const dimensions = SIZE_MAP[variant][size];
  const width = customWidth ?? dimensions.width;
  const height = customHeight ?? dimensions.height;

  // Icon variant is identical in light and dark mode (green rounded square with white pulse)
  if (variant === "icon") {
    const iconElement = (
      <span className={cn("inline-flex items-center justify-center shrink-0 select-none", className)}>
        <Image
          src="/branding/tabeeb-app-icon.png"
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className="h-auto w-auto object-contain"
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      </span>
    );

    if (href) {
      return (
        <Link href={href} className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
          {iconElement}
        </Link>
      );
    }
    return iconElement;
  }

  // Primary & Stacked variants: support light and dark wordmarks
  const lightSrc = variant === "primary" ? "/branding/tabeeb-logo-primary.png" : "/branding/tabeeb-logo-stacked.png";
  const darkSrc = variant === "primary" ? "/branding/tabeeb-logo-primary-dark.png" : "/branding/tabeeb-logo-stacked-dark.png";

  const logoElement = (
    <span className={cn("inline-flex items-center justify-center shrink-0 select-none", className)}>
      {theme === "auto" ? (
        <>
          <Image
            src={lightSrc}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            className="h-auto w-auto object-contain dark:hidden"
            style={{ width: `${width}px`, height: `${height}px` }}
          />
          <Image
            src={darkSrc}
            alt={alt}
            width={width}
            height={height}
            priority={priority}
            className="hidden h-auto w-auto object-contain dark:inline-block"
            style={{ width: `${width}px`, height: `${height}px` }}
          />
        </>
      ) : theme === "dark" ? (
        <Image
          src={darkSrc}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className="h-auto w-auto object-contain"
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      ) : (
        <Image
          src={lightSrc}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className="h-auto w-auto object-contain"
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      )}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
        {logoElement}
      </Link>
    );
  }

  return logoElement;
}
