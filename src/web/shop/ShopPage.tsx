import { useParams } from 'react-router';

// Placeholder for the phone shop (/s/:storeId).
export default function ShopPage() {
  const { storeId } = useParams();
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Shop</h1>
        <p className="mt-2 text-neutral-600">Store: {storeId}</p>
      </div>
    </main>
  );
}
