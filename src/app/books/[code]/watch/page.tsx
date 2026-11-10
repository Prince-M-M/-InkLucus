import { MediaPage } from "@/components/MediaPage";

export const metadata = { title: "Watch" };

export default async function Watch({ params }: { params: Promise<{ code: string }> }) {
  return <MediaPage code={(await params).code} kind="VIDEO" />;
}
