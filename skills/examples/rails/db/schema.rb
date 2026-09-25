ActiveRecord::Schema[8.0].define(version: 2026_01_01_000000) do
  create_table 'crm_members', force: :cascade do |t|
    t.string 'email', null: false
    t.string 'type'
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
    t.index ['email'], unique: true
  end
  create_table 'teams', force: :cascade do |t|
    t.string 'name', null: false
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
  end
  create_table 'memberships', force: :cascade do |t|
    t.integer 'member_id', null: false
    t.integer 'team_id', null: false
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
    t.index ['member_id']
    t.index ['team_id']
    t.index ['member_id', 'team_id'], unique: true
  end
  create_table 'notes', force: :cascade do |t|
    t.string 'notable_type', null: false
    t.integer 'notable_id', null: false
    t.text 'body'
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
    t.index ['notable_type', 'notable_id']
  end
  create_table 'admin_people', force: :cascade do |t|
    t.string 'name', null: false
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
  end
  create_table 'cacti', force: :cascade do |t|
    t.string 'name', null: false
    t.datetime 'created_at', null: false
    t.datetime 'updated_at', null: false
  end
  add_foreign_key 'memberships', 'crm_members', column: 'member_id'
  add_foreign_key 'memberships', 'teams'
end
