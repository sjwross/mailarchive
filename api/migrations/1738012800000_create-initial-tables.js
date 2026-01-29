export const up = (pgm) => {
  pgm.createTable("mailarchive_users", {
    id: { type: "varchar(22)", primaryKey: true },
    email: { type: "varchar(255)", notNull: true, unique: true },
    password_hash: { type: "varchar(255)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("mailarchive_connections", {
    id: { type: "varchar(22)", primaryKey: true },
    user_id: { type: "varchar(22)", notNull: true, references: "mailarchive_users(id)", onDelete: "CASCADE" },
    provider: { type: "varchar(50)", notNull: true },
    config_encrypted: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mailarchive_connections", "user_id");

  pgm.createTable("mailarchive_rules", {
    id: { type: "varchar(22)", primaryKey: true },
    user_id: { type: "varchar(22)", notNull: true, references: "mailarchive_users(id)", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    age_threshold_days: { type: "integer", notNull: true },
    folder_ids: { type: "jsonb", notNull: true, default: "[]" },
    safety_mode: { type: "varchar(20)", notNull: true },
    schedule: { type: "varchar(20)", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mailarchive_rules", "user_id");
};

export const down = (pgm) => {
  pgm.dropTable("mailarchive_rules");
  pgm.dropTable("mailarchive_connections");
  pgm.dropTable("mailarchive_users");
};
