import { StoreProvider } from "@/lib/store";
import Shell from "@/components/Shell";

export default function Page() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
