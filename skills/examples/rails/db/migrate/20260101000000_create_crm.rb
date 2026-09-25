class CreateCrm < ActiveRecord::Migration[8.0]
  def change
    create_table :crm_members do |t|
      t.string :email, null: false
      t.string :type
      t.timestamps
    end
    add_index :crm_members, :email, unique: true
    create_table :teams do |t|
      t.string :name, null: false
      t.timestamps
    end
    create_table :memberships do |t|
      t.references :member, null: false, foreign_key: { to_table: :crm_members }
      t.references :team, null: false, foreign_key: true
      t.timestamps
    end
    add_index :memberships, [:member_id, :team_id], unique: true
    create_table :notes do |t|
      t.references :notable, polymorphic: true, null: false
      t.text :body
      t.timestamps
    end
    create_table :admin_people do |t|
      t.string :name, null: false
      t.timestamps
    end
    create_table :cacti do |t|
      t.string :name, null: false
      t.timestamps
    end
  end
end
