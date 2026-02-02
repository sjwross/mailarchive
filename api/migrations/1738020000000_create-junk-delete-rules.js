export const up = (pgm) => {
  pgm.createTable("mailarchive_junk_delete_rules", {
    id: { type: "varchar(22)", primaryKey: true },
    user_id: { type: "varchar(22)", notNull: true, references: "mailarchive_users(id)", onDelete: "CASCADE" },
    name: { type: "varchar(255)", notNull: true },
    enabled: { type: "boolean", notNull: true, default: true },
    schedule: { type: "varchar(20)", notNull: true, default: "manual" },
    last_run_at: { type: "timestamptz" },
    max_per_run: { type: "integer", notNull: true, default: 50 },
    config: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("mailarchive_junk_delete_rules", "user_id");
};

export const down = (pgm) => {
  pgm.dropTable("mailarchive_junk_delete_rules");
};
