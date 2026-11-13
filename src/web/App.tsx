import { Route, Routes } from 'react-router';
import OpsPage from './ops/OpsPage';
import ScreenPage from './screen/ScreenPage';
import ShopPage from './shop/ShopPage';

export default function App() {
  return (
    <Routes>
      <Route path="/s/:storeId" element={<ShopPage />} />
      <Route path="/screen" element={<ScreenPage />} />
      <Route path="/ops" element={<OpsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <h1 className="text-2xl font-semibold">Bodega</h1>
    </main>
  );
}
