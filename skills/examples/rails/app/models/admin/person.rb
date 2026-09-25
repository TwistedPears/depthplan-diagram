class Admin::Person < ApplicationRecord
  self.table_name = 'admin_people'
  validates :name, presence: true
end
