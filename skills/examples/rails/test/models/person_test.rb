require 'test_helper'

class PersonTest < ActiveSupport::TestCase
  test 'email is required' do
    assert_not Person.new.valid?
  end
end
