import { MediaPage } from "@/components/MediaPage";

export const metadata = { title: "Listen" };

export default async function Listen({ params }: { params: Promise<{ code: string }> }) {
  return <MediaPage code={(await params).code} kind="AUDIO" />;
}
