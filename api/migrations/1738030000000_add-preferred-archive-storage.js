export const up = (pgm) => {
  pgm.addColumn("mailarchive_users", {
    preferred_archive_storage: { type: "varchar(20)", notNull: false },
  });
};

export const down = (pgm) => {
  pgm.dropColumn("mailarchive_users", "preferred_archive_storage");
};
