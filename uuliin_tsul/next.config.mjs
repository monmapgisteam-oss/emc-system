/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Нэгдсэн системийн сервер (backend/app/main.py) статик файлаар үйлчилнэ
  output: "export",
  // @arcgis/core нь ESM-ээр тархдаг тул Next-ийн серверт хөрвүүлэлт хэрэгтэй
  transpilePackages: ["@arcgis/core"],
};
export default nextConfig;
