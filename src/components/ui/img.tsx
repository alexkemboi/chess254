import Image, { type ImageProps } from "next/image";

/**
 * next/image for local and uploaded media. External URLs entered in the CMS are
 * rendered unoptimised so the optimiser is never used as an open image proxy.
 */
export function Img(props: ImageProps) {
  const external = typeof props.src === "string" && /^https?:\/\//.test(props.src);
  return <Image {...props} unoptimized={external || props.unoptimized} alt={props.alt} />;
}
