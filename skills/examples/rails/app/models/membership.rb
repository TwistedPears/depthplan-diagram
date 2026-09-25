class Membership < ApplicationRecord
  belongs_to :member, class_name: 'Person', foreign_key: :member_id, inverse_of: :memberships
  belongs_to :team
end
