const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "data", "choco-kanasu.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'Chocolate',
  featured INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  text TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const productCount = db.prepare("SELECT COUNT(*) AS c FROM products").get().c;
if (!productCount) {
  const seed = db.prepare(`
    INSERT INTO products (name, slug, description, price, stock, category, featured)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const products = [
    ["Milk Chocolate","milk-chocolate","Creamy, smooth and rich homemade chocolate.",0,25,"Classic",1],
    ["Dry Fruits Chocolate","dry-fruits-chocolate","Rich chocolate with a delicious crunchy dry-fruit finish.",0,20,"Signature",1],
    ["Dark Chocolate","dark-chocolate","Deep, intense chocolate flavour for dark-chocolate lovers.",0,18,"Classic",1],
    ["Sugar-Free Chocolate","sugar-free-chocolate","A delicious sugar-free chocolate option.",0,15,"Special",0],
    ["Kunafa Chocolate","kunafa-chocolate","A luxurious fusion of chocolate and kunafa texture.",0,22,"Signature",1]
  ];
  products.forEach(p => seed.run(...p));
}

const reviewCount = db.prepare("SELECT COUNT(*) AS c FROM reviews").get().c;
if (!reviewCount) {
  const seedReview = db.prepare(`
    INSERT INTO reviews (name, rating, text, approved, featured) VALUES (?, ?, ?, 1, 1)
  `);
  seedReview.run("Shruthi",5,"Absolutely loved the chocolate! The taste was rich, creamy and felt genuinely homemade. The presentation was beautiful too.");
  seedReview.run("Shanvi",5,"The Kunafa Chocolate was amazing! Such a unique combination and the texture was delicious. Definitely want to try the other varieties.");
  seedReview.run("Rupesh Kumar",5,"Really good quality and rich chocolate flavour. The dry fruits chocolate was my favourite. Perfect for gifting as well.");
  seedReview.run("Hemant Rao",5,"Loved the taste and freshness. The dark chocolate had a really nice rich flavour. Will definitely order again.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/products", (req,res) => {
  const rows = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY featured DESC, id").all();
  res.json(rows);
});

app.get("/api/reviews", (req,res) => {
  const rows = db.prepare("SELECT * FROM reviews WHERE approved=1 ORDER BY featured DESC, id DESC").all();
  res.json(rows);
});

app.post("/api/orders", (req,res) => {
  const {customer_name, phone, email, address, items, total} = req.body;
  if (!customer_name || !phone || !address || !Array.isArray(items) || !items.length) {
    return res.status(400).json({error:"Missing required order details."});
  }
  const orderNumber = "CK-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const tx = db.transaction(() => {
    for (const item of items) {
      const product = db.prepare("SELECT id, stock, name FROM products WHERE id=? AND active=1").get(item.id);
      if (!product || product.stock < item.qty) throw new Error(`${product ? product.name : "Product"} is unavailable.`);
    }
    for (const item of items) {
      db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.qty, item.id);
    }
    db.prepare(`
      INSERT INTO orders (order_number,customer_name,phone,email,address,items_json,total)
      VALUES (?,?,?,?,?,?,?)
    `).run(orderNumber, customer_name, phone, email || "", address, JSON.stringify(items), Number(total) || 0);
  });
  try {
    tx();
    res.json({ok:true, order_number:orderNumber});
  } catch(e) {
    res.status(400).json({error:e.message});
  }
});

app.get("/api/admin/summary", (req,res) => {
  const products = db.prepare("SELECT COUNT(*) c FROM products WHERE active=1").get().c;
  const orders = db.prepare("SELECT COUNT(*) c FROM orders").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='Pending'").get().c;
  const sales = db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status!='Cancelled'").get().s;
  const lowStock = db.prepare("SELECT COUNT(*) c FROM products WHERE active=1 AND stock<=5").get().c;
  res.json({products,orders,pending,sales,lowStock});
});

app.get("/api/admin/orders", (req,res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC").all());
});

app.get("/api/admin/products", (req,res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/admin/products", (req,res) => {
  const p = req.body;
  if (!p.name || !p.description) return res.status(400).json({error:"Name and description are required."});
  const slug = (p.name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  try {
    const info = db.prepare(`
      INSERT INTO products (name,slug,description,price,stock,category,featured,active)
      VALUES (?,?,?,?,?,?,?,1)
    `).run(p.name, slug + "-" + Date.now(), p.description, Number(p.price)||0, Number(p.stock)||0, p.category||"Chocolate", p.featured?1:0);
    res.json({id:info.lastInsertRowid});
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.put("/api/admin/products/:id", (req,res) => {
  const p = req.body;
  db.prepare(`
    UPDATE products SET name=?,description=?,price=?,stock=?,category=?,featured=?,active=?
    WHERE id=?
  `).run(p.name,p.description,Number(p.price)||0,Number(p.stock)||0,p.category||"Chocolate",p.featured?1:0,p.active===0?0:1,req.params.id);
  res.json({ok:true});
});

app.delete("/api/admin/products/:id", (req,res) => {
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.put("/api/admin/orders/:id/status", (req,res) => {
  const allowed = ["Pending","Confirmed","Preparing","Ready","Out for Delivery","Delivered","Cancelled"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({error:"Invalid status"});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);
  res.json({ok:true});
});

app.get("/api/admin/reviews", (req,res) => {
  res.json(db.prepare("SELECT * FROM reviews ORDER BY id DESC").all());
});

app.post("/api/admin/reviews", (req,res) => {
  const {name,rating,text} = req.body;
  if(!name || !text) return res.status(400).json({error:"Name and text are required."});
  const info = db.prepare("INSERT INTO reviews(name,rating,text,approved,featured) VALUES(?,?,?,1,1)")
    .run(name, Math.max(1,Math.min(5,Number(rating)||5)), text);
  res.json({id:info.lastInsertRowid});
});

app.put("/api/admin/reviews/:id", (req,res) => {
  const r=req.body;
  db.prepare("UPDATE reviews SET name=?,rating=?,text=?,approved=?,featured=? WHERE id=?")
    .run(r.name,Number(r.rating)||5,r.text,r.approved?1:0,r.featured?1:0,req.params.id);
  res.json({ok:true});
});

app.delete("/api/admin/reviews/:id", (req,res) => {
  db.prepare("DELETE FROM reviews WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

app.get("/{*splat}", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Choco Kanasu running at http://localhost:${PORT}`));
