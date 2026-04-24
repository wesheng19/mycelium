import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mycelium — Field Journal",
    short_name: "Mycelium",
    description: "Personal second brain — capture daily learnings.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3ede1",
    theme_color: "#f3ede1",
    orientation: "portrait",
    icons: [
      {
        src: "/icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
