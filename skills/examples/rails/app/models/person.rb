class Person < ApplicationRecord
  self.table_name = 'crm_members'
  include Notifies
  validates :email, presence: true, uniqueness: true
  has_many :memberships, foreign_key: :member_id, inverse_of: :member
  has_many :teams, through: :memberships
  has_many :notes, as: :notable
end
