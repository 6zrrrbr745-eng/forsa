
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
  
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/" || path === "/api") {
        return json({
          success: true,
          message: "FORSA API is running"
        });
      }

      if (path === "/api/orders" && request.method === "POST") {
        const body = await request.json();

        const name = String(body.customer_name || "").trim();
        const phone = String(body.phone || "").trim();
        const city = String(body.city || "").trim();
        const details = String(body.details || "").trim();
        const items = body.items;
        const total = Number(body.total);

        if (!name || !phone || !city ||
            !Array.isArray(items) || !items.length ||
            !Number.isFinite(total) || total < 0) {
          return json({ success: false, message: "بيانات الطلب غير مكتملة" }, 400);
        }

        if (name.length > 120 || phone.length > 30 ||
            city.length > 100 || details.length > 3000 ||
            items.length > 50) {
          return json({ success: false, message: "البيانات أكبر من المسموح" }, 400);
        }

        const id = crypto.randomUUID();
        const createdAt = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO orders
          (id, customer_name, phone, city, details, items_json, total, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, name, phone, city, details,
          JSON.stringify(items), Math.round(total), "جديد", createdAt
        ).run();

        return json({
          success: true,
          message: "تم استلام طلبك بنجاح",
          order_id: id
        }, 201);
      }

      if (path === "/api/orders" && request.method === "GET") {
        const id = url.searchParams.get("id");
        const phone = url.searchParams.get("phone");

        if (!id || !phone) {
          return json({ success: false, message: "أدخل رقم الطلب والهاتف" }, 400);
        }

        const order = await env.DB.prepare(`
          SELECT id, customer_name, city, items_json, total, status, created_at
          FROM orders WHERE id = ? AND phone = ?
        `).bind(id, phone).first();

        if (!order) {
          return json({ success: false, message: "الطلب غير موجود" }, 404);
        }

        return json({
          success: true,
          order: {
            ...order,
            items: JSON.parse(order.items_json)
          }
        });
      }

      if (path.startsWith("/api/admin/")) {
        const authorization = request.headers.get("Authorization");
        const token = authorization?.startsWith("Bearer ")
          ? authorization.slice(7)
          : "";

        if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
          return json({ success: false, message: "غير مصرح" }, 401);
        }
      }

      if (path === "/api/admin/orders" && request.method === "GET") {
        const result = await env.DB.prepare(`
          SELECT id, customer_name, phone, city, details,
                 items_json, total, status, created_at
          FROM orders ORDER BY created_at DESC LIMIT 200
        `).all();

        return json({
          success: true,
          orders: (result.results || []).map(order => ({
            ...order,
            items: JSON.parse(order.items_json)
          }))
        });
      }

      if (path.startsWith("/api/admin/orders/") && request.method === "PATCH") {
        const id = path.split("/").pop();
        const body = await request.json();
        const status = String(body.status || "");
        const allowed = ["جديد", "قيد التنفيذ", "مكتمل", "ملغي"];

        if (!id || !allowed.includes(status)) {
          return json({ success: false, message: "حالة غير صحيحة" }, 400);
        }

        const result = await env.DB.prepare(`
          UPDATE orders SET status = ? WHERE id = ?
        `).bind(status, id).run();

        if (!result.meta.changes) {
          return json({ success: false, message: "الطلب غير موجود" }, 404);
        }

        return json({ success: true, message: "تم تحديث حالة الطلب" });
      }

      return json({ success: false, message: "المسار غير موجود" }, 404);

    } catch (error) {
      console.error("FORSA API error:", error);
      return json({ success: false, message: "حدث خطأ داخلي" }, 500);
    }
  }
};
